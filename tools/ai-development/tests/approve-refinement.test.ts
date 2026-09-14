import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { approveRefinement, approvedState } from "../src/commands/approve-refinement.js";
import { commitRefinementApproval, inspectCandidate } from "../src/approval-git.js";
import { runCli } from "../src/cli.js";
import { parseRestrictedYaml } from "../src/validation.js";
import { verifyPendingRefinementCandidate, verifyRefinementApproval } from "../src/refinement-verifier.js";
import { sha256 } from "../src/hashes.js";
import type { WorkItemState } from "../src/state.js";
import { approvalFixture, DATE, fingerprint, testGit, URL } from "./approval-helpers.js";
import { ID } from "./helpers.js";

test("successful transition creates one STATE-only commit; exact evidence freshly verifies no-op", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const briefBefore = await readFile(join(f.directory, "BRIEF.md"));
  const output = await approveRefinement(f.root, ID, URL, f.transport);
  assert.match(output, /not pushed/);
  const head = testGit(f.root, ["rev-parse", "HEAD"]).toString().trim();
  assert.notEqual(head, f.candidate);
  assert.equal(testGit(f.root, ["rev-parse", "HEAD^" ]).toString().trim(), f.candidate);
  assert.equal(testGit(f.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).toString().trim(), `.ai-development/work-items/${ID}/STATE.yml`);
  assert.equal(testGit(f.root, ["log", "-1", "--format=%s"]).toString().trim(), `chore(ai-dev): approve refinement for ${ID}`);
  assert.deepEqual(await readFile(join(f.directory, "BRIEF.md")), briefBefore);
  const state = parseRestrictedYaml(await readFile(f.statePath)) as WorkItemState;
  assert.equal(state.state, "refinement_approved"); assert.equal(state.revision, 1);
  assert.deepEqual(state.gates.plan, { status: "pending" });
  assert.deepEqual(state.last_transition, { from: "refinement_pending", to: "refinement_approved", at: DATE, actor: "smaran:approve-refinement/v1" });
  assert.equal(state.gates.refinement.approval!.at, DATE);
  assert.equal(state.gates.refinement.approval!.actor.id, "github-user:123");
  assert.equal(state.gates.refinement.approval!.evidence.body_sha256, sha256(Buffer.from(f.data.comment.body)));
  assert.equal(testGit(f.root, ["status", "--porcelain"]).length, 0);
  const beforeNoop = await fingerprint(f.root, f.statePath);
  let calls = 0; const original = f.transport.permission;
  f.transport.permission = async login => { calls++; return original(login); };
  assert.match(await approveRefinement(f.root, ID, URL, f.transport), /no-op/);
  assert.equal(calls, 1); assert.deepEqual(await fingerprint(f.root, f.statePath), beforeNoop);
  await assert.rejects(approveRefinement(f.root, ID, URL.replace("issuecomment-2", "issuecomment-3"), f.transport), /DIFFERENT_EVIDENCE/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), beforeNoop);
});

for (const [label, invalidate] of Object.entries({
  "authorization removed": (f: any) => { f.policy.approvals.refinement.authorized_github_users = []; },
  "permission removed": (f: any) => { f.data.permission.permission = "read"; },
  "evidence edited": (f: any) => { f.data.graph.data.node.userContentEdits.totalCount = 1; },
  "evidence deleted": (f: any) => { f.transport.comment = async () => null; },
  "GitHub unavailable": (f: any) => { f.transport.repository = async () => { throw new Error("unavailable"); }; },
  "candidate history invalidated": (f: any) => { f.transport.ancestry = async (base: string) => ({ base_commit: { sha: base }, merge_base_commit: { sha: "d".repeat(40) }, status: "diverged" }); },
  "published Brief changed": (f: any) => { const original = f.transport.file; f.transport.file = async (sha: string, path: string) => path.endsWith("BRIEF.md") ? Buffer.from("changed") : original(sha, path); },
})) test(`approved evidence re-verification blocks ${label}; never rewrites history`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, f.transport); invalidate(f);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport));
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
for (const [label, change] of Object.entries({
  "dirty tracked file": async (f: any) => { await writeFile(join(f.root, "source.md"), "changed\n"); },
  "staged file": async (f: any) => { await writeFile(join(f.root, "source.md"), "changed\n"); testGit(f.root, ["add", "source.md"]); },
  "untracked file": async (f: any) => { await writeFile(join(f.root, "untracked.txt"), "synthetic\n"); },
  "detached HEAD": async (f: any) => { testGit(f.root, ["switch", "--detach", "-q"]); },
  "wrong branch": async (f: any) => { testGit(f.root, ["switch", "-qc", "codex/wrong"]); },
  "assume unchanged index": async (f: any) => { testGit(f.root, ["update-index", "--assume-unchanged", "source.md"]); },
})) test(`local safety rejects ${label}; preserves HEAD/STATE/index`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup); await change(f);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport));
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
for (const operation of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer"]) test(`local safety rejects ${operation}`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const path = testGit(f.root, ["rev-parse", "--path-format=absolute", "--git-path", operation]).toString().trim();
  if (operation.includes("HEAD")) await writeFile(path, f.base + "\n"); else await mkdir(path);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /GIT_OPERATION_IN_PROGRESS/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
test("root mismatch fails before mutation", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(inspectCandidate(f.directory, f.state.repository.feature_branch!), /ROOT_MISMATCH/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
test("concurrent HEAD movement during external verification blocks commit", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  let raced: Awaited<ReturnType<typeof fingerprint>>;
  f.transport.permission = async () => { testGit(f.root, ["commit", "--allow-empty", "-qm", "synthetic concurrent writer"]); raced = await fingerprint(f.root, f.statePath); return f.data.permission; };
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /HEAD_CHANGED/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), raced!);
});
test("transaction expected HEAD compare rejects race; state/index remain untouched", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const snapshot = await inspectCandidate(f.root, f.state.repository.feature_branch!);
  testGit(f.root, ["commit", "--allow-empty", "-qm", "synthetic concurrent writer"]);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(commitRefinementApproval(snapshot, `.ai-development/work-items/${ID}/STATE.yml`, f.stateBytes, Buffer.from("unused"), ID), /HEAD_CHANGED/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
test("index lock contention fails atomically", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const snapshot = await inspectCandidate(f.root, f.state.repository.feature_branch!);
  await writeFile(snapshot.indexPath + ".lock", "synthetic other writer");
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport));
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
  assert.equal(await readFile(snapshot.indexPath + ".lock", "utf8"), "synthetic other writer");
});
test("untrusted Git hooks are never run", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const hookDir = join(f.root, ".git/hooks");
  for (const hook of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "reference-transaction"]) await writeFile(join(hookDir, hook), "#!/bin/sh\nexit 93\n", { mode: 0o755 });
  await approveRefinement(f.root, ID, URL, f.transport);
  assert.equal(testGit(f.root, ["status", "--porcelain"]).length, 0);
});
test("revision overflow blocks command atomically", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  f.state.revision = Number.MAX_SAFE_INTEGER; await f.save(); testGit(f.root, ["add", "--", ".ai-development"]); testGit(f.root, ["commit", "-qm", "synthetic maximum revision"]);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /REVISION_OVERFLOW/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
  const verified = await verifyPendingRefinementCandidate({ ...f.state, revision: 0 }, f.ctx);
  if (verified.status === "verified") assert.throws(() => approvedState(f.state, verified.approval), /REVISION_OVERFLOW/);
});
for (const args of [ ["approve-refinement", ID], ["approve-refinement", ID, "--evidence", URL, "--evidence", URL],
  ["approve-refinement", ID, "--evidence", URL, "extra"], ["approve-refinement", ID, "--force", URL],
  ["approve-refinement", ID, "--offline", URL], ["approve-refinement", ID, "--skip-verification", URL] ]) test(`CLI strict arguments ${args.slice(2).join(" ") || "missing evidence"}`, async () => {
  let output = ""; assert.equal(await runCli(args, { stderr: text => { output += text; } }), 2); assert.match(output, /Usage/); assert.doesNotMatch(output, /at .*\.ts:/);
});

test("approved record historical policy must authorize actor, even if current policy does", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, f.transport);
  const originalBranch = f.transport.branch; const originalFile = f.transport.file;
  testGit(f.root, ["switch", "-q", "dev-neelesh"]);
  testGit(f.root, ["commit", "--allow-empty", "-qm", "synthetic policy advancement"]);
  const current = testGit(f.root, ["rev-parse", "HEAD"]).toString().trim();
  testGit(f.root, ["switch", "-q", "codex/test-approval"]);
  f.transport.branch = async name => name === "dev-neelesh" ? { name, commit: { sha: current } } : originalBranch(name);
  f.transport.file = async (sha, path) => {
    if (sha === f.base && path === ".ai-development/pipeline.config.yml") {
      const old = structuredClone(f.policy); old.approvals.refinement.authorized_github_users = [];
      return Buffer.from(stringify(old));
    }
    return originalFile(sha, path);
  };
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /HISTORICAL_POLICY_UNAUTHORIZED/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
test("approved record unsupported review evidence never authenticates refinement", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, f.transport);
  const state = parseRestrictedYaml(await readFile(f.statePath)) as WorkItemState;
  state.gates.refinement.approval!.evidence.kind = "github_review";
  assert.deepEqual(await verifyRefinementApproval(state, f.ctx), { status: "invalid", reason: "DIFFERENT_EVIDENCE" });
});

test("repository-configured external Git filters are rejected before status can invoke them", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  testGit(f.root, ["config", "filter.synthetic.clean", "untrusted-command-that-must-not-run"]);
  const before = await fingerprint(f.root, f.statePath);
  await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /UNSUPPORTED_GIT_FILTERS/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
