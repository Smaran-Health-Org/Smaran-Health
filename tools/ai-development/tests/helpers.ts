import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { findRepositoryRoot } from "../src/config.js";
import { sha256 } from "../src/hashes.js";
import type { Approval, WorkflowState, WorkItemState } from "../src/state.js";

export const repositoryRoot = await findRepositoryRoot(fileURLToPath(new URL(".", import.meta.url)));
export const ID = "TEST-001";
export const briefBytes = Buffer.from("# Synthetic pipeline fixture\nNo patient or clinical data.\n");
const commit = "a".repeat(40);

function approval(hash: string): Approval {
  return { actor: { kind: "human", id: "synthetic-human" }, at: "2026-09-14T00:00:00Z", artifact_sha256: hash, artifact_commit: commit,
    evidence: { kind: "github_comment", id: "1", url: "https://github.com/example/synthetic/issues/1#issuecomment-1" } };
}

export function syntheticState(state: WorkflowState = "refinement_pending"): WorkItemState {
  const directory = `.ai-development/work-items/${ID}`;
  const value: WorkItemState = {
    schema_version: "ai-development-state/v1", work_item_id: ID, title: "Synthetic test fixture", state,
    revision: state === "refinement_pending" ? 0 : 1,
    repository: { identifier: "DrSmaranAI/Smaran-Health", target_branch: "dev-neelesh" }, sources: [],
    artifacts: { brief: { path: `${directory}/BRIEF.md` } }, gates: { refinement: { status: "pending" }, plan: { status: "pending" } },
  };
  if (state !== "refinement_pending") {
    value.repository.base_commit = commit;
    value.repository.source_commit = commit;
    value.artifacts.brief.sha256 = sha256(briefBytes);
    value.gates.refinement = { status: "approved", approval: approval(value.artifacts.brief.sha256) };
  }
  if (["planning", "plan_ready", "plan_approved"].includes(state)) value.provenance = { run_id: "synthetic-run-1", input_commit: commit };
  if (["plan_ready", "plan_approved"].includes(state)) {
    value.artifacts.context = { path: `${directory}/CONTEXT.json`, sha256: sha256(Buffer.from("{}\n")) };
    value.artifacts.plan = { path: `${directory}/PLAN.md`, sha256: sha256(Buffer.from("# Synthetic plan\n")) };
  }
  if (state === "plan_approved") value.gates.plan = { status: "approved", approval: approval(value.artifacts.plan!.sha256!) };
  return value;
}

export async function fixture(state = syntheticState()) {
  const root = await mkdtemp(join(tmpdir(), "smaran-ai-dev-test-"));
  const pipeline = join(root, ".ai-development");
  await mkdir(pipeline);
  await cp(join(repositoryRoot, ".ai-development/schemas"), join(pipeline, "schemas"), { recursive: true });
  await cp(join(repositoryRoot, ".ai-development/pipeline.config.yml"), join(pipeline, "pipeline.config.yml"));
  const directory = join(pipeline, "work-items", ID);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "BRIEF.md"), briefBytes);
  if (state.artifacts.context) await writeFile(join(directory, "CONTEXT.json"), "{}\n");
  if (state.artifacts.plan) await writeFile(join(directory, "PLAN.md"), "# Synthetic plan\n");
  const statePath = join(directory, "STATE.yml");
  await writeFile(statePath, stringify(state));
  return { root, directory, statePath, state,
    save: async () => writeFile(statePath, stringify(state)),
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

export async function schema(name: "config" | "state"): Promise<object> {
  return JSON.parse(await readFile(join(repositoryRoot, `.ai-development/schemas/${name}.schema.json`), "utf8")) as object;
}
