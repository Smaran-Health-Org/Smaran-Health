import { dirname, join, resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { InputError, readPipelineBytes } from "./paths.js";
import { loadSchemaValidator, MAX_YAML_BYTES, parseRestrictedYaml, schemaIssues } from "./validation.js";
import type { WorkflowState } from "./state.js";

export interface PipelineConfig {
  schema_version: "ai-development-config/v1";
  repository: string;
  artifact_root: ".ai-development";
  work_item_root: ".ai-development/work-items";
  target_branch: string;
  supported_states: WorkflowState[];
  policy: { max_yaml_bytes: number; max_artifact_bytes: number; max_depth: number };
}

export async function findRepositoryRoot(start = process.cwd()): Promise<string> {
  let current = resolve(start);
  while (true) {
    try {
      // lstat lets the later safety layer reject a symlinked pipeline root.
      await lstat(join(current, ".ai-development"));
      return current;
    } catch { /* continue upwards */ }
    const parent = dirname(current);
    if (parent === current) throw new InputError("Pipeline root not found; run from the repository or its tool package.");
    current = parent;
  }
}

export async function loadConfig(repoRoot: string): Promise<PipelineConfig> {
  const bytes = await readPipelineBytes(repoRoot, ".ai-development/pipeline.config.yml", MAX_YAML_BYTES);
  const raw = parseRestrictedYaml(bytes);
  const validate = await loadSchemaValidator<PipelineConfig>(repoRoot, "config");
  const issues = schemaIssues(validate, raw);
  if (issues.length) throw new InputError(`Invalid pipeline configuration: ${issues.join(" ")}`);
  const config = raw as PipelineConfig;
  // A configuration may tighten hard limits, never expand them.
  parseRestrictedYaml(bytes, config.policy.max_yaml_bytes, config.policy.max_depth);
  return config;
}
