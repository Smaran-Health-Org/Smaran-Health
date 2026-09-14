import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRefinement } from "../src/commands/approve-refinement.js";
import { approvalFixture, fingerprint, URL } from "./approval-helpers.js";
import { ID } from "./helpers.js";

for (const phase of ["read-tree", "hash-object", "update-index", "write-tree", "commit-tree", "update-ref"]) test(`Git ${phase} failure before commit preserves HEAD, STATE, index and clean worktree`, async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const before = await fingerprint(f.root, f.statePath);
  const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const wrapperRoot = await mkdtemp(join(tmpdir(), "smaran-fake-git-")); t.after(() => rm(wrapperRoot, { recursive: true, force: true }));
  await writeFile(join(wrapperRoot, "git"), `#!${process.execPath}\n` + `
const {spawnSync,spawn} = require("node:child_process");
const args = process.argv.slice(2);
if (args.includes(${JSON.stringify(phase)})) { process.stderr.write("synthetic failure private data"); process.exit(1); }
const child = spawn(${JSON.stringify(gitPath)}, args, { stdio:"inherit", env:process.env });
child.on("exit", code => process.exit(code ?? 1));
`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${wrapperRoot}:${previous}`;
  try { await assert.rejects(approveRefinement(f.root, ID, URL, f.transport)); }
  finally { process.env.PATH = previous; }
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
  const index = execFileSync(gitPath, ["-C", f.root, "rev-parse", "--path-format=absolute", "--git-path", "index"], { encoding: "utf8" }).trim();
  await assert.rejects(readFile(index + ".lock"));
});

test("ref commit rejection after prepare removes prepared STATE and index lock atomically", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const before = await fingerprint(f.root, f.statePath);
  const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const wrapperRoot = await mkdtemp(join(tmpdir(), "smaran-fake-ref-")); t.after(() => rm(wrapperRoot, { recursive: true, force: true }));
  await writeFile(join(wrapperRoot, "git"), `#!${process.execPath}\n` + `
const {spawn} = require("node:child_process");
const args = process.argv.slice(2);
if (args.includes("update-ref")) {
  let input = ""; let prepared = false;
  process.stdin.on("data", chunk => {
    input += chunk.toString();
    if (!prepared && input.includes("prepare\\0")) { prepared = true; process.stdout.write("start: ok\\nprepare: ok\\n"); }
    if (input.includes("commit\\0")) { process.stderr.write("synthetic ref failure"); process.exit(1); }
  });
} else { const child = spawn(${JSON.stringify(gitPath)}, args, {stdio:"inherit"}); child.on("exit", code => process.exit(code ?? 1)); }
`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${wrapperRoot}:${previous}`;
  try { await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /LOCAL_REF_TRANSACTION_FAILED/); }
  finally { process.env.PATH = previous; }
  assert.deepEqual(await fingerprint(f.root, f.statePath), before);
});

test("concurrent ref movement immediately before Git prepare fails compare-and-swap", async (t) => {
  const f = await approvalFixture(); t.after(f.cleanup);
  const before = await fingerprint(f.root, f.statePath);
  const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const tree = execFileSync(gitPath, ["-C", f.root, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  const racedCommit = execFileSync(gitPath, ["-c", "user.name=Synthetic", "-c", "user.email=s@invalid", "-C", f.root, "commit-tree", tree, "-p", f.candidate], { encoding: "utf8", input: "synthetic race\n" }).trim();
  const wrapperRoot = await mkdtemp(join(tmpdir(), "smaran-cas-race-")); t.after(() => rm(wrapperRoot, { recursive: true, force: true }));
  await writeFile(join(wrapperRoot, "git"), `#!${process.execPath}\n` + `
const {spawn,execFileSync} = require("node:child_process");
const args = process.argv.slice(2);
if (args.includes("update-ref")) execFileSync(${JSON.stringify(gitPath)}, ["-C",${JSON.stringify(f.root)},"update-ref","refs/heads/codex/test-approval",${JSON.stringify(racedCommit)},${JSON.stringify(f.candidate)}]);
const child = spawn(${JSON.stringify(gitPath)}, args, {stdio:"inherit"}); child.on("exit", code => process.exit(code ?? 1));
`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = `${wrapperRoot}:${previous}`;
  try { await assert.rejects(approveRefinement(f.root, ID, URL, f.transport), /LOCAL_REF_TRANSACTION_FAILED/); }
  finally { process.env.PATH = previous; }
  const after = await fingerprint(f.root, f.statePath);
  assert.equal(after.head.trim(), racedCommit); assert.deepEqual(after.state, before.state); assert.deepEqual(after.index, before.index); assert.equal(after.status, "");
});
