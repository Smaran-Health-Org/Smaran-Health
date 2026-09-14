import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { approveRefinement } from "../src/commands/approve-refinement.js";
import { inspectCandidate } from "../src/approval-git.js";
import { verifyPendingRefinementCandidate, verifyRefinementApproval } from "../src/refinement-verifier.js";
import { parseRestrictedYaml } from "../src/validation.js";
import type { WorkItemState } from "../src/state.js";
import { approvalFixture, fingerprint, testGit, URL } from "./approval-helpers.js";
import { ID } from "./helpers.js";

type Fixture = Awaited<ReturnType<typeof approvalFixture>>;
async function verify(f: Fixture) {
  const state = parseRestrictedYaml(await readFile(f.statePath)) as WorkItemState;
  return verifyRefinementApproval(state, { ...f.ctx, local: await inspectCandidate(f.root, "codex/test-approval") });
}
function head(f: Fixture) { return testGit(f.root, ["rev-parse", "HEAD"]).toString().trim(); }
function publish(f: Fixture) { f.data.remote = head(f); f.data.pr.head.sha = head(f); }
async function commit(f: Fixture, extra?: string) {
  const state = parseRestrictedYaml(await readFile(f.statePath)) as WorkItemState;
  state.revision++;
  await writeFile(f.statePath, stringify(state));
  if (extra) await writeFile(join(f.root, extra), "changed synthetic bytes\n");
  testGit(f.root, ["add", "--", "."]); testGit(f.root, ["commit", "-qm", "synthetic pipeline state"]);
}

test("AIRV1-001 initial published C requires exact local/remote/PR equality", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  assert.equal((await verifyPendingRefinementCandidate(f.state, f.ctx)).status, "verified");
  testGit(f.root, ["commit", "--allow-empty", "-qm", "synthetic stale candidate"]);
  assert.notEqual((await verifyPendingRefinementCandidate(f.state, f.ctx)).status, "verified");
});
test("AIRV1-001 local A with remote/PR C is explicitly supported", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport });
  assert.equal(f.data.remote, f.candidate);
  const result = await verify(f); assert.equal(result.status, "verified");
  if (result.status === "verified") assert.equal(result.approval.artifact_commit, f.candidate);
});
test("AIRV1-001 published STATE-only A verifies immutable C", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport }); publish(f);
  const result = await verify(f); assert.equal(result.status, "verified");
  if (result.status === "verified") assert.equal(result.approval.artifact_commit, f.candidate);
});
test("AIRV1-001 published A repeated approval is no-op with unchanged revision/index/HEAD", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport }); publish(f);
  const before = await fingerprint(f.root, f.statePath);
  assert.match(await approveRefinement(f.root, ID, URL, { transport: f.transport }), /no-op/);
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});
test("AIRV1-001 C to A to synthetic STATE-only B retains C approval", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport }); await commit(f); publish(f);
  assert.equal((await verify(f)).status, "verified");
  assert.match(await approveRefinement(f.root, ID, URL, { transport: f.transport }), /no-op/);
});
for (const surface of ["remote", "PR", "both"]) test(`AIRV1-001 force-push ${surface} replacement blocks unrelated existing C`, async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport });
  // Real base commit exists, but does not descend from candidate C.
  if (surface !== "PR") f.data.remote = f.base;
  if (surface !== "remote") f.data.pr.head.sha = f.base;
  assert.notEqual((await verify(f)).status, "verified");
});
test("AIRV1-001 rebase removing C from local ancestry blocks even while C object exists", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport });
  const tree = testGit(f.root, ["rev-parse", "HEAD^{tree}"]).toString().trim();
  const replacement = testGit(f.root, ["commit-tree", tree, "-p", f.base, "-m", "synthetic rewritten approval"]).toString().trim();
  testGit(f.root, ["update-ref", "refs/heads/codex/test-approval", replacement]);
  testGit(f.root, ["cat-file", "-e", f.candidate]); publish(f);
  assert.notEqual((await verify(f)).status, "verified");
});
for (const [label, path] of [["Brief changed after approval", `.ai-development/work-items/${ID}/BRIEF.md`], ["later unrelated file", "source.md"]] as const) test(`AIRV1-001 blocks ${label}`, async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport }); await commit(f, path); publish(f);
  assert.notEqual((await verify(f)).status, "verified");
});
for (const [label, path] of [["A not STATE-only", "source.md"], ["A changes Brief", `.ai-development/work-items/${ID}/BRIEF.md`]] as const) test(`AIRV1-001 blocks ${label}`, async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport });
  await writeFile(join(f.root, path), "changed synthetic bytes\n");
  testGit(f.root, ["add", "--", path]); testGit(f.root, ["commit", "--amend", "--no-edit", "-q"]); publish(f);
  assert.notEqual((await verify(f)).status, "verified");
});
test("AIRV1-001 wrong recorded artifact_commit cannot rebind approval to A", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport }); publish(f);
  const state = parseRestrictedYaml(await readFile(f.statePath)) as WorkItemState;
  state.gates.refinement.approval!.artifact_commit = head(f);
  assert.deepEqual(await verifyRefinementApproval(state, { ...f.ctx, local: await inspectCandidate(f.root, "codex/test-approval") }),
    { status: "invalid", reason: "DIFFERENT_EVIDENCE" });
});
test("AIRV1-001 empty current allowlist still disables recorded approval", async t => {
  const f = await approvalFixture(); t.after(f.cleanup);
  await approveRefinement(f.root, ID, URL, { transport: f.transport }); publish(f);
  f.policy.approvals.refinement.authorized_github_users = [];
  assert.deepEqual(await verify(f), { status: "invalid", reason: "APPROVAL_DISABLED" });
});
