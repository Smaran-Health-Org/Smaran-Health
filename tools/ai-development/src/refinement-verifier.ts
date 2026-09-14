import { isDeepStrictEqual } from "node:util";
import type { ValidateFunction } from "ajv";
import type { Bootstrap } from "./bootstrap.js";
import { assertApproverPolicy, type PipelineConfig } from "./config.js";
import { parseEvidenceUrl, matchesApprovalStatement } from "./approval-evidence.js";
import { object, stableId, type GitHubTransport } from "./github.js";
import { sha256 } from "./hashes.js";
import { assertArtifactPath, assertRelativePath, InputError, workItemPath } from "./paths.js";
import { stateConsistencyIssues, type Approval, type WorkItemState } from "./state.js";
import { parseRestrictedYaml } from "./validation.js";

export interface TrustedContext {
  bootstrap: Bootstrap;
  github: GitHubTransport;
  // Validators supplied by reviewed launcher code, never candidate STATE/schema.
  configValidator: ValidateFunction<PipelineConfig>;
  stateValidator: ValidateFunction<WorkItemState>;
  candidate: string;
  candidateStateBytes: Buffer;
  briefBytes: Buffer;
  evidenceUrl: string;
}
export type VerificationResult = { status: "verified"; approval: Approval }
  | { status: "invalid" | "unverifiable"; reason: string };
function requireCondition(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new InputError(reason);
}
function timestamp(value: unknown): string {
  requireCondition(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value, "GITHUB_MALFORMED_RESPONSE");
  return value;
}
function exactCommit(raw: unknown, expected: string): void {
  requireCondition(object(raw).sha === expected, "COMMIT_MISMATCH");
}
async function ancestor(github: GitHubTransport, base: string, head: string): Promise<void> {
  const compare = object(await github.ancestry(base, head));
  requireCondition(object(compare.base_commit).sha === base && object(compare.merge_base_commit).sha === base
    && (compare.status === "ahead" || compare.status === "identical"), "ANCESTRY_INVALID");
}

/** Fresh read-only verification. Records are never authentication. No caller boolean
 * or candidate policy grants authority. Both failure categories block advancement.
 */
export async function verifyRefinementApproval(state: WorkItemState, ctx: TrustedContext): Promise<VerificationResult> {
  try {
    requireCondition(ctx.stateValidator(state) && !stateConsistencyIssues(state).length, "STATE_INVALID");
    const { repository, targetBranch } = ctx.bootstrap;
    requireCondition(state.repository.identifier === repository && state.repository.target_branch === targetBranch, "REPOSITORY_MISMATCH");
    requireCondition(/^[a-f0-9]{40}$/.test(ctx.candidate), "CANDIDATE_INVALID");
    const location = parseEvidenceUrl(ctx.evidenceUrl, repository);
    const recorded = state.gates.refinement.approval;
    requireCondition(!recorded || (recorded.evidence.kind === "github_comment" && recorded.evidence.url === location.url
      && recorded.artifact_commit === ctx.candidate), "DIFFERENT_EVIDENCE");
    // Resolve target once, then fetch policy bytes at this immutable commit.
    const repo = object(await ctx.github.repository());
    requireCondition(repo.full_name === repository, "REPOSITORY_MISMATCH");
    const target = object(await ctx.github.branch(targetBranch));
    requireCondition(target.name === targetBranch, "TARGET_MISMATCH");
    const policyCommit = object(target.commit).sha;
    requireCondition(typeof policyCommit === "string" && /^[a-f0-9]{40}$/.test(policyCommit), "GITHUB_MALFORMED_RESPONSE");
    exactCommit(await ctx.github.commit(policyCommit), policyCommit);
    const policyBytes = await ctx.github.file(policyCommit, ".ai-development/pipeline.config.yml");
    const rawPolicy = parseRestrictedYaml(policyBytes);
    requireCondition(ctx.configValidator(rawPolicy), "POLICY_INVALID");
    const policy = rawPolicy as PipelineConfig;
    assertApproverPolicy(policy);
    parseRestrictedYaml(policyBytes, policy.policy.max_yaml_bytes, policy.policy.max_depth);
    requireCondition(policy.repository === repository && policy.target_branch === targetBranch, "POLICY_IDENTITY_MISMATCH");
    const users = policy.approvals.refinement.authorized_github_users;
    requireCondition(users.length > 0, "APPROVAL_DISABLED");

    const pendingRaw = parseRestrictedYaml(ctx.candidateStateBytes, policy.policy.max_yaml_bytes, policy.policy.max_depth);
    requireCondition(ctx.stateValidator(pendingRaw), "CANDIDATE_STATE_INVALID");
    const pending = pendingRaw as WorkItemState;
    requireCondition(pending.state === "refinement_pending" && pending.gates.refinement.status === "pending"
      && pending.gates.plan.status === "pending" && !pending.gates.refinement.approval
      && !stateConsistencyIssues(pending).length, "CANDIDATE_STATE_INVALID");
    if (!recorded) requireCondition(isDeepStrictEqual(state, pending), "CANDIDATE_STATE_MISMATCH");
    else {
      // Later workflow states may use this verifier; frozen candidate inputs must persist.
      requireCondition(isDeepStrictEqual(state.repository, pending.repository) && isDeepStrictEqual(state.sources, pending.sources)
        && isDeepStrictEqual(state.artifacts.brief, pending.artifacts.brief) && state.work_item_id === pending.work_item_id,
      "CANDIDATE_STATE_MISMATCH");
    }
    const branch = pending.repository.feature_branch;
    const base = pending.repository.base_commit;
    const source = pending.repository.source_commit;
    requireCondition(branch && base && source && pending.artifacts.brief.sha256, "PROVENANCE_MISSING");
    requireCondition(branch !== targetBranch, "FEATURE_BRANCH_INVALID");
    assertArtifactPath(pending.artifacts.brief.path, pending.work_item_id);
    requireCondition(ctx.briefBytes.length <= policy.policy.max_artifact_bytes
      && sha256(ctx.briefBytes) === pending.artifacts.brief.sha256, "BRIEF_HASH_MISMATCH");
    exactCommit(await ctx.github.commit(ctx.candidate), ctx.candidate);
    exactCommit(await ctx.github.commit(base), base);
    exactCommit(await ctx.github.commit(source), source);
    const remote = object(await ctx.github.branch(branch));
    requireCondition(remote.name === branch && object(remote.commit).sha === ctx.candidate, "REMOTE_BRANCH_MISMATCH");
    const pr = object(await ctx.github.pull(location.pr));
    const prBase = object(pr.base); const prHead = object(pr.head);
    requireCondition(stableId(pr.number) === location.pr && pr.state === "open"
      && pr.html_url === `https://github.com/${repository}/pull/${location.pr}`
      && object(prBase.repo).full_name === repository && object(prHead.repo).full_name === repository
      && prBase.ref === targetBranch && prHead.ref === branch && prHead.sha === ctx.candidate, "PR_MISMATCH");
    requireCondition((await ctx.github.file(ctx.candidate, `${workItemPath(pending.work_item_id)}/STATE.yml`)).equals(ctx.candidateStateBytes), "PUBLISHED_STATE_MISMATCH");
    requireCondition((await ctx.github.file(ctx.candidate, pending.artifacts.brief.path)).equals(ctx.briefBytes), "PUBLISHED_BRIEF_MISMATCH");
    await ancestor(ctx.github, base, source);
    await ancestor(ctx.github, source, policyCommit);
    await ancestor(ctx.github, source, ctx.candidate);
    for (const reference of pending.sources) {
      assertRelativePath(reference.path);
      requireCondition(reference.commit === source && reference.sha256, "SOURCE_UNPINNED");
      const bytes = await ctx.github.file(source, reference.path);
      requireCondition(bytes.length <= policy.policy.max_artifact_bytes && sha256(bytes) === reference.sha256, "SOURCE_HASH_MISMATCH");
    }

    const comment = object(await ctx.github.comment(location.comment));
    requireCondition(stableId(comment.id) === location.comment && comment.html_url === location.url
      && comment.issue_url === `https://api.github.com/repos/${repository}/issues/${location.pr}`
      && typeof comment.node_id === "string" && typeof comment.body === "string", "COMMENT_MISMATCH");
    const user = object(comment.user);
    requireCondition(user.type === "User" && typeof user.login === "string", "ACTOR_INVALID");
    const id = stableId(user.id);
    const allowed = users.find((entry) => entry.id === id && entry.login.toLowerCase() === (user.login as string).toLowerCase());
    requireCondition(allowed, "ACTOR_UNAUTHORIZED");
    const created = timestamp(comment.created_at); const updated = timestamp(comment.updated_at);
    requireCondition(created === updated, "COMMENT_EDITED");
    const graph = object(await ctx.github.commentIntegrity(comment.node_id));
    requireCondition(!("errors" in graph), "GITHUB_MALFORMED_RESPONSE");
    const node = object(object(graph.data).node);
    const author = object(node.author); const pull = object(node.pullRequest);
    requireCondition(node.__typename === "IssueComment" && node.id === comment.node_id && stableId(node.databaseId) === location.comment
      && node.url === location.url && node.body === comment.body && node.createdAt === created && node.updatedAt === updated
      && author.__typename === "User" && author.login === user.login && stableId(author.databaseId) === id
      && stableId(pull.number) === location.pr && object(pull.repository).nameWithOwner === repository, "COMMENT_METADATA_MISMATCH");
    // All integrity fields required, including explicit null (undefined never passes).
    requireCondition(node.lastEditedAt === null && node.editor === null && node.isMinimized === false
      && object(node.userContentEdits).totalCount === 0, "COMMENT_INTEGRITY_INVALID");
    requireCondition(matchesApprovalStatement(comment.body, { repository, workItem: pending.work_item_id,
      candidate: ctx.candidate, briefHash: pending.artifacts.brief.sha256 }), "STATEMENT_MISMATCH");
    const permission = object(await ctx.github.permission(allowed.login));
    const permittedUser = object(permission.user);
    requireCondition(permittedUser.type === "User" && stableId(permittedUser.id) === id
      && typeof permittedUser.login === "string" && permittedUser.login.toLowerCase() === allowed.login.toLowerCase(), "PERMISSION_IDENTITY_MISMATCH");
    requireCondition(permission.permission === "write" || permission.permission === "maintain" || permission.permission === "admin", "PERMISSION_DENIED");
    const approval: Approval = { actor: { kind: "human", id: `github-user:${id}` }, at: created,
      artifact_sha256: pending.artifacts.brief.sha256, artifact_commit: ctx.candidate,
      evidence: { kind: "github_comment", url: location.url, id: location.comment, body_sha256: sha256(Buffer.from(comment.body, "utf8")), updated_at: updated },
      verification: { version: "refinement-approval/v1", policy_commit: policyCommit } };
    if (recorded) {
      // Policy commit may advance, but historical event/integrity metadata must match.
      requireCondition(isDeepStrictEqual({ ...recorded, verification: approval.verification }, approval), "RECORDED_APPROVAL_MISMATCH");
      exactCommit(await ctx.github.commit(recorded.verification.policy_commit), recorded.verification.policy_commit);
      await ancestor(ctx.github, recorded.verification.policy_commit, policyCommit);
      const historicalBytes = await ctx.github.file(recorded.verification.policy_commit, ".ai-development/pipeline.config.yml");
      const historicalRaw = parseRestrictedYaml(historicalBytes);
      requireCondition(ctx.configValidator(historicalRaw), "HISTORICAL_POLICY_INVALID");
      const historical = historicalRaw as PipelineConfig;
      assertApproverPolicy(historical);
      parseRestrictedYaml(historicalBytes, historical.policy.max_yaml_bytes, historical.policy.max_depth);
      requireCondition(historical.repository === repository && historical.target_branch === targetBranch
        && historical.approvals.refinement.authorized_github_users.some((entry) => entry.id === id && entry.login.toLowerCase() === allowed.login.toLowerCase()),
      "HISTORICAL_POLICY_UNAUTHORIZED");
    }
    return { status: "verified", approval };
  } catch (error) {
    const reason = error instanceof InputError ? error.message : "GITHUB_UNAVAILABLE";
    const unverifiable = reason === "GITHUB_UNAVAILABLE" || reason === "GITHUB_MALFORMED_RESPONSE";
    // Only fixed reason codes escape the trust boundary (never raw parser errors).
    return { status: unverifiable ? "unverifiable" : "invalid", reason: /^[A-Z][A-Z0-9_]*$/.test(reason) ? reason : "CONTRACT_INVALID" };
  }
}
