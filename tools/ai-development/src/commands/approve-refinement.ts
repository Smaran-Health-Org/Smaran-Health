import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { BOOTSTRAP } from "../bootstrap.js";
import type { PipelineConfig } from "../config.js";
import { parseEvidenceUrl } from "../approval-evidence.js";
import { candidateFile, commitRefinementApproval, executingRepositoryRoot, inspectCandidate } from "../approval-git.js";
import { GhTransport, type GitHubTransport } from "../github.js";
import { InputError, assertArtifactPath, readPipelineBytes, workItemPath } from "../paths.js";
import { verifyPendingRefinementCandidate, verifyRefinementApproval } from "../refinement-verifier.js";
import { assertTransition, stateConsistencyIssues, type WorkItemState } from "../state.js";
import { loadSchemaValidator, MAX_ARTIFACT_BYTES, MAX_YAML_BYTES, parseRestrictedYaml } from "../validation.js";

export { approvedState } from "../approval-state.js";
import { approvedState } from "../approval-state.js";

/** Library/trusted-launcher seams, never candidate-controlled CLI flags. */
export interface ApprovalOptions {
  transport?: GitHubTransport;
  launcherRoot?: string;
  expectedHead?: string;
  assertLauncherTrust?: () => Promise<void>;
}
export async function approveRefinement(root: string, id: string, evidenceUrl: string, options: ApprovalOptions = {}): Promise<string> {
  if (options.expectedHead !== undefined && !/^[a-f0-9]{40}$/.test(options.expectedHead)) throw new InputError("INVALID_CANDIDATE_COMMIT");
  const path = `${workItemPath(id)}/STATE.yml`;
  parseEvidenceUrl(evidenceUrl, BOOTSTRAP.repository);
  // Resolve contracts relative to executing reviewed tool, not the requested worktree.
  const launcherRoot = options.launcherRoot ?? await executingRepositoryRoot(fileURLToPath(import.meta.url));
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
  const snapshot = await inspectCandidate(root, state.repository.feature_branch, options.expectedHead);
  const candidate = recorded?.artifact_commit ?? snapshot.head;
  assertArtifactPath(state.artifacts.brief.path, id);
  const briefBytes = await readPipelineBytes(root, state.artifacts.brief.path, MAX_ARTIFACT_BYTES);
  const candidateStateBytes = await candidateFile(snapshot, candidate, path);
  if (!(await candidateFile(snapshot, candidate, state.artifacts.brief.path)).equals(briefBytes)) throw new InputError("LOCAL_BRIEF_CHANGED");
  if (!recorded && !candidateStateBytes.equals(bytes)) throw new InputError("LOCAL_STATE_CHANGED");
  const context = { bootstrap: BOOTSTRAP, github: options.transport ?? new GhTransport(BOOTSTRAP.repository, { verifierToken: process.env.SMARAN_AI_DEV_VERIFIER_TOKEN }),
    stateValidator, configValidator, candidate, candidateStateBytes, briefBytes, evidenceUrl, local: snapshot };
  const result = recorded ? await verifyRefinementApproval(state, context)
    : await verifyPendingRefinementCandidate(state, context);
  if (result.status !== "verified") throw new InputError(`${result.status.toUpperCase()}: ${result.reason}`);
  await options.assertLauncherTrust?.();
  await inspectCandidate(root, snapshot.branch, snapshot.head);
  if (recorded) return `${id}: approval freshly verified; no-op (no new commit).`;
  // Boolean exists solely inside trusted orchestrator control flow after verifier success.
  assertTransition(state.state, "refinement_approved", { authority: "orchestrator", inputsUnchanged: true, refinementApprovalVerified: true });
  const next = approvedState(state, result.approval);
  if (!stateValidator(next) || stateConsistencyIssues(next).length) throw new InputError("TRANSITION_INVALID");
  const commit = await commitRefinementApproval(snapshot, path, bytes, Buffer.from(stringify(next)), id);
  return `${id}: refinement approved in local STATE-only commit ${commit}; not pushed.`;
}
