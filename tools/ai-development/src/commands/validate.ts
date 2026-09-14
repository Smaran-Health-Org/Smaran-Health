import { loadConfig } from "../config.js";
import { sha256 } from "../hashes.js";
import { assertArtifactPath, assertRelativePath, assertWorkItemId, InputError, readPipelineBytes, workItemPath } from "../paths.js";
import { stateConsistencyIssues } from "../state.js";
import type { WorkItemState } from "../state.js";
import { loadSchemaValidator, parseRestrictedYaml, schemaIssues } from "../validation.js";

export interface ArtifactReadiness { name: string; present: boolean; hash: "matched" | "not recorded" | "mismatched" | "unavailable" }
export interface ValidationReport {
  valid: boolean;
  state?: WorkItemState;
  issues: string[];
  artifacts: ArtifactReadiness[];
}

export async function validateWorkItem(repoRoot: string, id: string): Promise<ValidationReport> {
  const report: ValidationReport = { valid: false, issues: [], artifacts: [] };
  try {
    assertWorkItemId(id);
    const config = await loadConfig(repoRoot);
    const raw = parseRestrictedYaml(await readPipelineBytes(repoRoot, `${workItemPath(id)}/STATE.yml`, config.policy.max_yaml_bytes), config.policy.max_yaml_bytes, config.policy.max_depth);
    const validate = await loadSchemaValidator<WorkItemState>(repoRoot, "state");
    report.issues.push(...schemaIssues(validate, raw));
    if (report.issues.length) return report;
    const state = raw as WorkItemState;
    report.state = state;
    if (state.work_item_id !== id) report.issues.push("State Work Item ID does not match the requested directory.");
    if (state.repository.identifier !== config.repository) report.issues.push("Recorded repository does not match pipeline configuration.");
    if (state.repository.target_branch !== config.target_branch) report.issues.push("Recorded target branch does not match pipeline configuration.");
    report.issues.push(...stateConsistencyIssues(state));
    for (const source of state.sources) {
      try { assertRelativePath(source.path); }
      catch (error) { report.issues.push(`Source reference: ${message(error)}`); }
    }
    for (const [name, artifact] of Object.entries(state.artifacts)) {
      const readiness: ArtifactReadiness = { name, present: false, hash: "unavailable" };
      report.artifacts.push(readiness);
      try {
        assertArtifactPath(artifact.path, id);
        const bytes = await readPipelineBytes(repoRoot, artifact.path, config.policy.max_artifact_bytes);
        readiness.present = true;
        if (artifact.sha256) {
          readiness.hash = sha256(bytes) === artifact.sha256 ? "matched" : "mismatched";
          if (readiness.hash === "mismatched") report.issues.push(`${name} artifact SHA-256 does not match recorded bytes.`);
        } else readiness.hash = "not recorded";
      } catch (error) { report.issues.push(`${name} artifact: ${message(error)}`); }
    }
    report.valid = report.issues.length === 0;
  } catch (error) { report.issues.push(message(error)); }
  return report;
}

export function message(error: unknown): string {
  return error instanceof InputError ? error.message : "Unable to validate pipeline input; check file access and contracts.";
}
