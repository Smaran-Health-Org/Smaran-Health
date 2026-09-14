import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { stringify } from "yaml";
import { BOOTSTRAP } from "../bootstrap.js";
import { findRepositoryRoot, type PipelineConfig } from "../config.js";
import { parseEvidenceUrl } from "../approval-evidence.js";
import { approvalParent, candidateFile, commitRefinementApproval, inspectCandidate } from "../approval-git.js";
import { GhTransport, type GitHubTransport } from "../github.js";
import { InputError, assertArtifactPath, readPipelineBytes, workItemPath } from "../paths.js";
import { verifyRefinementApproval } from "../refinement-verifier.js";
import { assertTransition, stateConsistencyIssues, type Approval, type WorkItemState } from "../state.js";
import { loadSchemaValidator, MAX_ARTIFACT_BYTES, MAX_YAML_BYTES, parseRestrictedYaml } from "../validation.js";

/** Deterministic mutation derived only after successful independent verification. */
export function approvedState(pending: WorkItemState, approval: Approval): WorkItemState {
  if (pending.state !== "refinement_pending" || pending.gates.refinement.status !== "pending"
    || pending.gates.refinement.approval || pending.gates.plan.status !== "pending") throw new InputError("TRANSITION_INVALID");
  if (!Number.isSafeInteger(pending.revision) || pending.revision >= Number.MAX_SAFE_INTEGER) throw new InputError("REVISION_OVERFLOW");
  const next = structuredClone(pending);
  next.state = "refinement_approved"; next.revision++;
  next.gates.refinement = { status: "approved", approval };
  next.last_transition = { from: "refinement_pending", to: "refinement_approved", at: approval.at, actor: "smaran:approve-refinement/v1" };
  return next;
}

/** Transport injection is a library test/trusted-launcher seam, never a CLI flag. */
export async function approveRefinement(root: string, id: string, evidenceUrl: string, transport?: GitHubTransport): Promise<string> {
  const path = `${workItemPath(id)}/STATE.yml`;
  parseEvidenceUrl(evidenceUrl, BOOTSTRAP.repository);
  // Resolve contracts relative to executing reviewed tool, not the requested worktree.
  const launcherRoot = await findRepositoryRoot(fileURLToPath(new URL(".", import.meta.url)));
  const stateValidator = await loadSchemaValidator<WorkItemState>(launcherRoot, "state");
  const configValidator = await loadSchemaValidator<PipelineConfig>(launcherRoot, "config");
  const bytes = await readPipelineBytes(root, path, MAX_YAML_BYTES);
  const raw = parseRestrictedYaml(bytes);
  if (!stateValidator(raw)) throw new InputError("STATE_INVALID");
  const state = raw as WorkItemState;
  if (state.work_item_id !== id || stateConsistencyIssues(state).length
    || !state.repository.feature_branch || state.gates.plan.status !== "pending"
    || (state.state !== "refinement_pending" && state.state !== "refinement_approved")) throw new InputError("STATE_INVALID");
  if (state.state === "refinement_pending" && state.revision >= Number.MAX_SAFE_INTEGER) throw new InputError("REVISION_OVERFLOW");
  const recorded = state.gates.refinement.approval;
  if (recorded && (recorded.evidence.kind !== "github_comment" || recorded.evidence.url !== evidenceUrl)) throw new InputError("DIFFERENT_EVIDENCE");
  const snapshot = await inspectCandidate(root, state.repository.feature_branch);
  const candidate = recorded?.artifact_commit ?? snapshot.head;
  assertArtifactPath(state.artifacts.brief.path, id);
  const briefBytes = await readPipelineBytes(root, state.artifacts.brief.path, MAX_ARTIFACT_BYTES);
  const candidateStateBytes = await candidateFile(snapshot, candidate, path);
  if (!(await candidateFile(snapshot, candidate, state.artifacts.brief.path)).equals(briefBytes)) throw new InputError("LOCAL_BRIEF_CHANGED");
  if (!recorded && !candidateStateBytes.equals(bytes)) throw new InputError("LOCAL_STATE_CHANGED");
  if (recorded) {
    await approvalParent(snapshot, candidate, path);
    const pending = parseRestrictedYaml(candidateStateBytes);
    if (!stateValidator(pending) || !isDeepStrictEqual(approvedState(pending as WorkItemState, recorded), state)) throw new InputError("APPROVAL_STATE_MISMATCH");
  }
  const result = await verifyRefinementApproval(state, { bootstrap: BOOTSTRAP, github: transport ?? new GhTransport(BOOTSTRAP.repository),
    stateValidator, configValidator, candidate, candidateStateBytes, briefBytes, evidenceUrl });
  if (result.status !== "verified") throw new InputError(`${result.status.toUpperCase()}: ${result.reason}`);
  await inspectCandidate(root, snapshot.branch, snapshot.head);
  if (recorded) return `${id}: approval freshly verified; no-op (no new commit).`;
  // Boolean exists solely inside trusted orchestrator control flow after verifier success.
  assertTransition(state.state, "refinement_approved", { authority: "orchestrator", inputsUnchanged: true, refinementApprovalVerified: true });
  const next = approvedState(state, result.approval);
  if (!stateValidator(next) || stateConsistencyIssues(next).length) throw new InputError("TRANSITION_INVALID");
  const commit = await commitRefinementApproval(snapshot, path, bytes, Buffer.from(stringify(next)), id);
  return `${id}: refinement approved in local STATE-only commit ${commit}; not pushed.`;
}
