import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { verifyRefinementApproval } from "../src/refinement-verifier.js";
import { InputError } from "../src/paths.js";
import { approveRefinement } from "../src/commands/approve-refinement.js";
import { approvalFixture, fingerprint, testGit, URL } from "./approval-helpers.js";
import { ID } from "./helpers.js";
type Fixture = Awaited<ReturnType<typeof approvalFixture>>;
const failures: Record<string, (f: Fixture) => void> = {
  "empty policy disables approval": f => { f.policy.approvals.refinement.authorized_github_users = []; },
  "unauthorized user": f => { f.policy.approvals.refinement.authorized_github_users = [{ login: "Other", id: "456" }]; },
  "login match ID mismatch": f => { f.policy.approvals.refinement.authorized_github_users[0]!.id = "456"; },
  "ID match login mismatch": f => { f.policy.approvals.refinement.authorized_github_users[0]!.login = "Other"; },
  "bot": f => { f.data.comment.user.type = "Bot"; }, "organization actor": f => { f.data.comment.user.type = "Organization"; },
  "deleted actor": f => { (f.data.comment as any).user = null; }, "unknown actor": f => { f.data.comment.user.type = "Unknown"; },
  "read permission": f => { f.data.permission.permission = "read"; }, "triage permission": f => { f.data.permission.permission = "triage"; },
  "permission API failure": f => { f.transport.permission = async () => { throw new InputError("GITHUB_UNAVAILABLE"); }; },
  "permission identity mismatch": f => { f.data.permission.user.id = 456; },
  "edited timestamp": f => { f.data.comment.updated_at = "2026-09-14T01:00:00Z"; },
  "edited then restored": f => { f.data.graph.data.node.userContentEdits.totalCount = 2; },
  "last edit recorded": f => { f.data.graph.data.node.lastEditedAt = "2026-09-14T01:00:00Z"; },
  "editor recorded": f => { f.data.graph.data.node.editor = { login: "ExampleHuman" }; },
  "minimized": f => { f.data.graph.data.node.isMinimized = true; },
  "missing comment": f => { f.transport.comment = async () => null; },
  "deleted evidence API failure": f => { f.transport.comment = async () => { throw new InputError("GITHUB_UNAVAILABLE"); }; },
  "REST GraphQL body disagreement": f => { f.data.graph.data.node.body += "\n"; },
  "REST GraphQL actor disagreement": f => { f.data.graph.data.node.author.databaseId = 456; },
  "REST GraphQL node disagreement": f => { f.data.graph.data.node.id = "IC_other"; },
  "GraphQL API failure": f => { f.transport.commentIntegrity = async () => { throw new InputError("GITHUB_UNAVAILABLE"); }; },
  "missing required integrity": f => { delete (f.data.graph.data.node as any).lastEditedAt; },
  "missing edit history": f => { delete (f.data.graph.data.node as any).userContentEdits; },
  "GraphQL errors": f => { (f.data.graph as any).errors = [{ message: "private-secret" }]; },
  "malformed response": f => { f.transport.pull = async () => "private-secret"; },
  "wrong comment PR": f => { f.data.comment.issue_url = f.data.comment.issue_url.replace("/1", "/9"); },
  "ordinary issue evidence": f => { (f.data.graph.data.node as any).pullRequest = null; },
  "wrong GraphQL repository": f => { f.data.graph.data.node.pullRequest.repository.nameWithOwner = "wrong/repo"; },
  "wrong canonical comment URL": f => { f.data.comment.html_url = URL + "extra"; },
  "wrong comment ID": f => { f.data.comment.id = 99; },
  "wrong statement": f => { f.data.comment.body += "\nExtra"; f.data.graph.data.node.body = f.data.comment.body; },
  "unpublished candidate": f => { const original = f.transport.commit; f.transport.commit = async sha => { if (sha === f.candidate) throw new InputError("GITHUB_UNAVAILABLE"); return original(sha); }; },
  "remote branch mismatch": f => { f.transport.branch = async name => ({ name, commit: { sha: f.base } }); },
  "wrong PR head": f => { f.data.pr.head.sha = f.base; },
  "wrong PR base": f => { f.data.pr.base.ref = "main"; },
  "wrong feature branch": f => { f.data.pr.head.ref = "codex/other"; },
  "wrong repository": f => { f.data.repo.full_name = "wrong/repo"; },
  "fork PR repository": f => { f.data.pr.head.repo = { full_name: "wrong/repo" }; },
  "closed PR": f => { f.data.pr.state = "closed"; },
  "mutated published Brief": f => { const original = f.transport.file; f.transport.file = async (sha, path) => path.endsWith("BRIEF.md") ? Buffer.from("changed") : original(sha, path); },
  "mutated published STATE": f => { const original = f.transport.file; f.transport.file = async (sha, path) => path.endsWith("STATE.yml") ? Buffer.concat([f.stateBytes, Buffer.from("\n")]) : original(sha, path); },
  "source bytes changed": f => { const original = f.transport.file; f.transport.file = async (sha, path) => path === "source.md" ? Buffer.from("changed") : original(sha, path); },
  "removed ancestry": f => { f.transport.ancestry = async base => ({ base_commit: { sha: base }, merge_base_commit: { sha: "b".repeat(40) }, status: "diverged" }); },
  "source no longer on target": f => { const original = f.transport.ancestry; f.transport.ancestry = async (base, head) => base === f.state.repository.source_commit && head === f.base ? { base_commit: { sha: base }, merge_base_commit: { sha: "b".repeat(40) }, status: "behind" } : original(base, head); },
  "source commit invalid": f => { f.transport.commit = async sha => ({ sha: sha === f.base ? "b".repeat(40) : sha }); },
  "target identity mismatch": f => { f.transport.branch = async name => ({ name: "wrong", commit: { sha: f.base } }); },
  "trusted policy identity mismatch": f => { f.policy.repository = "wrong/repo"; },
  "unsupported target policy version": f => { (f.policy as any).schema_version = "ai-development-config/v1"; },
  "policy duplicate login": f => { f.policy.approvals.refinement.authorized_github_users.push({ login: "examplehuman", id: "456" }); },
};
for (const [label, mutate] of Object.entries(failures)) test(`approval blocks ${label}; pre-commit failure atomicity`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup); mutate(f);
  const before = await fingerprint(f.root, f.statePath);
  const result = await verifyRefinementApproval(f.state, f.ctx);
  assert.notEqual(result.status, "verified");
  if (result.status !== "verified") assert.match(result.reason, /^[A-Z][A-Z0-9_]*$/);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport));
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
for (const permission of ["write", "maintain", "admin"]) test(`explicit allowlist plus ${permission} verifies`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup); f.data.permission.permission = permission;
  const result = await verifyRefinementApproval(f.state, f.ctx);
  assert.equal(result.status, "verified");
  if (result.status === "verified") {
    assert.equal(result.approval.actor.id, "github-user:123"); assert.equal(result.approval.verification.policy_commit, f.base);
  }
});
test("case insensitive configured login authorization", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup); f.policy.approvals.refinement.authorized_github_users[0]!.login = "EXAMPLEHUMAN";
  assert.equal((await verifyRefinementApproval(f.state, f.ctx)).status, "verified");
});
test("candidate allowlist injection cannot enable empty target policy", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup); f.policy.approvals.refinement.authorized_github_users = [];
  // Publish an actual synthetic candidate config that tries to allow its actor.
  const injected = structuredClone(f.policy);
  injected.approvals.refinement.authorized_github_users = [{ login: "ExampleHuman", id: "123" }];
  await writeFile(join(f.root, ".ai-development/pipeline.config.yml"), stringify(injected));
  testGit(f.root, ["add", "--", ".ai-development/pipeline.config.yml"]);
  testGit(f.root, ["commit", "-qm", "synthetic candidate policy injection"]);
  f.ctx.candidate = testGit(f.root, ["rev-parse", "HEAD"]).toString().trim();
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /APPROVAL_DISABLED/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
  assert.deepEqual(await verifyRefinementApproval(f.state, f.ctx), { status: "invalid", reason: "APPROVAL_DISABLED" });
});
for (const [label, mutate] of Object.entries({
  "candidate Brief recorded hash mismatch": (f: Fixture) => { f.state.artifacts.brief.sha256 = "d".repeat(64); },
  "unpinned source": (f: Fixture) => { delete f.state.sources[0]!.commit; },
  "source base mismatch": (f: Fixture) => { f.state.sources[0]!.commit = "d".repeat(40); },
  "pending plan not pending": (f: Fixture) => { f.state.gates.plan = { status: "invalidated", invalidation_reason: "synthetic" }; },
})) test(`verifier blocks ${label}`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup); mutate(f);
  f.ctx.candidateStateBytes = Buffer.from(stringify(f.state));
  const original = f.transport.file;
  f.transport.file = async (sha, path) => path.endsWith("STATE.yml") ? f.ctx.candidateStateBytes : original(sha, path);
  assert.notEqual((await verifyRefinementApproval(f.state, f.ctx)).status, "verified");
});
test("unverifiable responses produce sanitized category; invalid evidence produces invalid", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  f.transport.permission = async () => { throw new Error("token private-secret headers"); };
  assert.deepEqual(await verifyRefinementApproval(f.state, f.ctx), { status: "unverifiable", reason: "GITHUB_UNAVAILABLE" });
});
