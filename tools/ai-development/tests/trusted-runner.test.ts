import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import ts from "typescript";
import { inspectTrustedLauncher } from "../src/approval-git.js";
import { approveFromTrustedLauncher, assertTrustedRuntime, parseTrustedArguments, type TrustedApprovalRequest } from "../src/trusted-runner.js";
import { runTrustedApproval } from "../src/trusted-approval.js";
import { runCli } from "../src/cli.js";
import { parseRestrictedYaml } from "../src/validation.js";
import type { WorkItemState } from "../src/state.js";
import { approvalFixture, fingerprint, testGit, URL } from "./approval-helpers.js";
import { fixture, ID, repositoryRoot } from "./helpers.js";

const TOKEN = "fake-explicit-verifier-secret";
async function launcherFixture() {
  const f = await fixture();
  const tool = join(f.root, "tools/ai-development");
  await mkdir(tool, { recursive: true });
  await cp(join(repositoryRoot, "tools/ai-development/src"), join(tool, "src"), { recursive: true });
  await cp(join(repositoryRoot, "tools/ai-development/package.json"), join(tool, "package.json"));
  // This marker is deliberately nearer to the module than the real Git root.
  await mkdir(join(tool, "src/.ai-development/schemas"), { recursive: true });
  await writeFile(join(tool, "src/.ai-development/schemas/state.schema.json"), "false");
  testGit(f.root, ["init", "-q"]);
  testGit(f.root, ["add", "."]); testGit(f.root, ["commit", "-qm", "synthetic launcher"]);
  testGit(f.root, ["switch", "--detach", "-q"]);
  return { ...f, modulePath: join(tool, "src/trusted-approval.ts"), commit: head(f.root) };
}
function head(root: string) { return testGit(root, ["rev-parse", "HEAD"]).toString().trim(); }
async function pair(t: test.TestContext) {
  const launcher = await launcherFixture(); t.after(launcher.cleanup);
  const candidate = await approvalFixture(); t.after(candidate.cleanup);
  const request: TrustedApprovalRequest = { id: ID, evidenceUrl: URL, candidateRoot: candidate.root, candidateHead: candidate.candidate, launcherCommit: launcher.commit };
  const context = { modulePath: launcher.modulePath, env: { SMARAN_AI_DEV_VERIFIER_TOKEN: TOKEN }, runtimeArgs: [], transport: candidate.transport };
  return { launcher, candidate, request, context };
}
test("exact detached launcher and candidate succeed; nested marker and candidate code/contracts are excluded", async t => {
  const { launcher, candidate, request, context } = await pair(t);
  const tool = join(candidate.root, "tools/ai-development");
  await mkdir(join(tool, "src/.ai-development"), { recursive: true });
  const altered = "candidate-controlled fixture bytes; never executed";
  await writeFile(join(tool, "src/refinement-verifier.ts"), altered);
  await writeFile(join(tool, "src/trusted-approval.ts"), altered);
  await writeFile(join(tool, "package.json"), altered);
  for (const name of ["state", "config"]) await writeFile(join(candidate.root, `.ai-development/schemas/${name}.schema.json`), "false");
  testGit(candidate.root, ["add", "."]); testGit(candidate.root, ["commit", "--amend", "--no-edit", "-q"]);
  request.candidateHead = head(candidate.root);
  candidate.data.remote = request.candidateHead; candidate.data.pr.head.sha = request.candidateHead;
  candidate.data.comment.body = candidate.data.comment.body.replace(candidate.candidate, request.candidateHead);
  candidate.data.graph.data.node.body = candidate.data.comment.body;
  const selected = await inspectTrustedLauncher(context.modulePath, candidate.root, launcher.commit);
  assert.equal(selected, await realpath(launcher.root));
  assert.notEqual(await readFile(join(selected, "tools/ai-development/src/refinement-verifier.ts"), "utf8"), altered);
  assert.notEqual(await readFile(join(selected, "tools/ai-development/package.json"), "utf8"), altered);
  assert.match(await approveFromTrustedLauncher(request, context), /not pushed/);
  const state = parseRestrictedYaml(await readFile(candidate.statePath)) as WorkItemState;
  assert.equal(state.gates.refinement.approval!.artifact_commit, request.candidateHead);
});
for (const [label, change, reason] of [
  ["wrong launcher SHA", async (f: any) => { f.request.launcherCommit = "a".repeat(40); }, /LAUNCHER_HEAD_MISMATCH/],
  ["dirty launcher", async (f: any) => { await writeFile(join(f.launcher.root, "source.txt"), "dirty"); }, /WORKTREE_NOT_CLEAN/],
  ["same physical root", async (f: any) => { f.request.candidateRoot = f.launcher.root; }, /LAUNCHER_CANDIDATE_SAME_ROOT/],
  ["attached launcher", async (f: any) => { testGit(f.launcher.root, ["switch", "-qc", "launcher"]); }, /LAUNCHER_NOT_DETACHED/],
  ["hidden launcher index", async (f: any) => { testGit(f.launcher.root, ["update-index", "--skip-worktree", "tools/ai-development/src/trusted-approval.ts"]); }, /UNSUPPORTED_INDEX_FLAGS/],
  ["launcher filters", async (f: any) => { testGit(f.launcher.root, ["config", "filter.synthetic.clean", "never-execute"]); }, /UNSUPPORTED_GIT_FILTERS/],
  ["candidate mismatch", async (f: any) => { f.request.candidateHead = "a".repeat(40); }, /HEAD_CHANGED/],
  ["nested candidate root", async (f: any) => { f.request.candidateRoot = f.candidate.directory; }, /ROOT_MISMATCH/],
] as const) test(`trusted runner rejects ${label} before evidence/mutation`, async t => {
  const f = await pair(t); await change(f);
  let calls = 0; f.context.transport.repository = async () => { calls++; return f.candidate.data.repo; };
  const before = await fingerprint(f.candidate.root, f.candidate.statePath);
  await assert.rejects(approveFromTrustedLauncher(f.request, f.context), reason);
  assert.equal(calls, 0); assert.deepEqual(await fingerprint(f.candidate.root, f.candidate.statePath), before);
});
for (const operation of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer"]) test(`trusted launcher rejects ${operation}`, async t => {
  const f = await pair(t);
  const path = testGit(f.launcher.root, ["rev-parse", "--path-format=absolute", "--git-path", operation]).toString().trim();
  if (operation.includes("HEAD")) await writeFile(path, f.launcher.commit); else await mkdir(path);
  await assert.rejects(approveFromTrustedLauncher(f.request, f.context), /GIT_OPERATION_IN_PROGRESS/);
});
test("expected current HEAD binds recorded verification while evidence still binds original C", async t => {
  const f = await pair(t);
  await approveFromTrustedLauncher(f.request, f.context);
  const a = head(f.candidate.root); f.request.candidateHead = a;
  f.candidate.data.remote = a; f.candidate.data.pr.head.sha = a;
  const before = await fingerprint(f.candidate.root, f.candidate.statePath);
  assert.match(await approveFromTrustedLauncher(f.request, f.context), /no-op/);
  assert.deepEqual(await fingerprint(f.candidate.root, f.candidate.statePath), before);
  const state = parseRestrictedYaml(await readFile(f.candidate.statePath)) as WorkItemState;
  assert.equal(state.gates.refinement.approval!.artifact_commit, f.candidate.candidate);
  f.request.candidateHead = f.candidate.candidate;
  await assert.rejects(approveFromTrustedLauncher(f.request, f.context), /HEAD_CHANGED/);
});
test("candidate changes during evidence reads reject expected HEAD without overwriting writer", async t => {
  const f = await pair(t); let raced: Awaited<ReturnType<typeof fingerprint>>;
  f.context.transport.permission = async () => {
    testGit(f.candidate.root, ["commit", "--allow-empty", "-qm", "synthetic concurrent writer"]);
    raced = await fingerprint(f.candidate.root, f.candidate.statePath); return f.candidate.data.permission;
  };
  await assert.rejects(approveFromTrustedLauncher(f.request, f.context), /HEAD_CHANGED/);
  assert.deepEqual(await fingerprint(f.candidate.root, f.candidate.statePath), raced!);
});
test("launcher changes during evidence verification fail before candidate mutation", async t => {
  const f = await pair(t);
  f.context.transport.permission = async () => { await writeFile(join(f.launcher.root, "dirty.txt"), "dirty"); return f.candidate.data.permission; };
  const before = await fingerprint(f.candidate.root, f.candidate.statePath);
  await assert.rejects(approveFromTrustedLauncher(f.request, f.context), /WORKTREE_NOT_CLEAN/);
  assert.deepEqual(await fingerprint(f.candidate.root, f.candidate.statePath), before);
});
test("missing explicit credential blocks even injected transport and ambient human auth", async t => {
  const f = await pair(t);
  let calls = 0; f.context.transport.repository = async () => { calls++; return f.candidate.data.repo; };
  await assert.rejects(approveFromTrustedLauncher(f.request, { ...f.context, env: { GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN } }), /EXPLICIT_VERIFIER_CREDENTIAL_REQUIRED/);
  assert.equal(calls, 0);
});
test("physical root equality rejects candidate symlink alias", async t => {
  const f = await pair(t);
  const alias = join(f.candidate.root, "launcher-alias");
  await symlink(f.launcher.root, alias);
  await assert.rejects(approveFromTrustedLauncher({ ...f.request, candidateRoot: alias }, f.context), /LAUNCHER_CANDIDATE_SAME_ROOT/);
});
test("local Git subprocesses never receive verifier or ambient gh credentials", async t => {
  const f = await pair(t);
  const executable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const bin = join(f.launcher.root, ".git/synthetic-bin"); await mkdir(bin);
  const log = join(bin, "environment.jsonl");
  await writeFile(join(bin, "git"), `#!${process.execPath}\n` + `
const fs = require("node:fs"), cp = require("node:child_process");
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({absent:["SMARAN_AI_DEV_VERIFIER_TOKEN","GH_TOKEN","GITHUB_TOKEN"].every(k=>process.env[k]===undefined)})+"\\n");
const child=cp.spawn(${JSON.stringify(executable)},process.argv.slice(2),{stdio:"inherit",env:process.env});
child.on("exit",code=>process.exit(code??1));
`, { mode: 0o755 });
  const prior = { PATH: process.env.PATH, SMARAN_AI_DEV_VERIFIER_TOKEN: process.env.SMARAN_AI_DEV_VERIFIER_TOKEN, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  try {
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.SMARAN_AI_DEV_VERIFIER_TOKEN = TOKEN; process.env.GH_TOKEN = TOKEN; process.env.GITHUB_TOKEN = TOKEN;
    await inspectTrustedLauncher(f.context.modulePath, f.candidate.root, f.launcher.commit);
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  const requests = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(requests.length > 0); for (const request of requests) assert.deepEqual(request, { absent: true });
});
test("unsafe launcher index symlink is rejected", async t => {
  const f = await pair(t);
  const index = join(f.launcher.root, ".git/index");
  const bytes = await readFile(index);
  await writeFile(join(f.launcher.root, ".git/synthetic-index"), bytes);
  await unlink(index); await symlink("synthetic-index", index);
  await assert.rejects(approveFromTrustedLauncher(f.request, f.context), /UNSAFE_INDEX/);
});
test("actual built entrypoint uses launcher modules/contracts from candidate cwd; fake gh reads only", async t => {
  const f = await pair(t); const tool = join(f.launcher.root, "tools/ai-development");
  // Compile fixture trusted sources, never candidate code. No network/install or
  // deliberately malicious executable is used; candidate schema bytes are false.
  for (const path of await readdir(join(tool, "src"), { recursive: true })) {
    if (!path.endsWith(".ts")) continue;
    const output = join(tool, "dist/src", path.replace(/\.ts$/, ".js"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, ts.transpileModule(await readFile(join(tool, "src", path), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
  }
  await mkdir(join(tool, "dist/src/.ai-development/schemas"), { recursive: true });
  await writeFile(join(tool, "dist/src/.ai-development/schemas/state.schema.json"), "false");
  await writeFile(join(tool, ".gitignore"), "node_modules/\n");
  await cp(join(repositoryRoot, "tools/ai-development/node_modules"), join(tool, "node_modules"), { recursive: true });
  const bin = join(f.launcher.root, "bin"); await mkdir(bin);
  const log = join(f.launcher.root, ".git/synthetic-gh-reads.jsonl");
  const policy = await readFile(join(f.launcher.root, ".ai-development/pipeline.config.yml"));
  await writeFile(join(bin, "gh"), `#!${process.execPath}\n` + `
const fs = require("node:fs");
const args = process.argv.slice(2), endpoint = args[9];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({explicit:process.env.GH_TOKEN===${JSON.stringify(TOKEN)},isolated:fs.readdirSync(process.env.GH_CONFIG_DIR).length===0})+"\\n");
const repository=${JSON.stringify(f.candidate.data.repo)};
if(endpoint===${JSON.stringify(`repos/${f.candidate.data.repo.full_name}`)}) process.stdout.write(JSON.stringify(repository));
else if(endpoint.endsWith("/branches/dev-neelesh")) process.stdout.write(JSON.stringify({name:"dev-neelesh",commit:{sha:${JSON.stringify(f.candidate.base)}}}));
else if(endpoint.includes("/commits/")) process.stdout.write(JSON.stringify({sha:endpoint.split("/").pop()}));
else if(endpoint.endsWith("/contents/.ai-development/pipeline.config.yml")) process.stdout.write(JSON.stringify({type:"file",path:".ai-development/pipeline.config.yml",encoding:"base64",content:${JSON.stringify(policy.toString("base64"))},size:${policy.length}}));
else process.exit(91);
`, { mode: 0o755 });
  testGit(f.launcher.root, ["add", "."]); testGit(f.launcher.root, ["commit", "-qm", "synthetic built runtime"]);
  for (const name of ["state", "config"]) await writeFile(join(f.candidate.root, `.ai-development/schemas/${name}.schema.json`), "false");
  testGit(f.candidate.root, ["add", "."]); testGit(f.candidate.root, ["commit", "-qm", "synthetic candidate schemas"]);
  const candidateTool = join(f.candidate.root, "tools/ai-development");
  await mkdir(join(candidateTool, "src"), { recursive: true });
  await writeFile(join(candidateTool, "src/refinement-verifier.ts"), "inert candidate fixture bytes; never executed");
  await writeFile(join(candidateTool, "package.json"), "inert candidate metadata; never loaded");
  testGit(f.candidate.root, ["add", "."]); testGit(f.candidate.root, ["commit", "-qm", "synthetic candidate module copies"]);
  const args = [ID, "--evidence", URL, "--candidate-root", f.candidate.root, "--candidate-head", head(f.candidate.root), "--launcher-commit", head(f.launcher.root)];
  const before = await fingerprint(f.candidate.root, f.candidate.statePath);
  const result = spawnSync(process.execPath, [join(tool, "dist/src/trusted-approval.js"), ...args], {
    cwd: f.candidate.root, encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, SMARAN_AI_DEV_VERIFIER_TOKEN: TOKEN },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /Trusted approval failed/);
  assert.ok(!(result.stdout + result.stderr).includes(TOKEN));
  const requests = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(requests.length, 4); // Trusted schemas accepted; empty policy blocked.
  for (const request of requests) assert.deepEqual(request, { explicit: true, isolated: true });
  assert.deepEqual(await fingerprint(f.candidate.root, f.candidate.statePath), before);
});
test("runtime diagnostic rejects loader/preload environment and flags without echoing values", () => {
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "TSX_TSCONFIG_PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "npm_config_node_options"]) {
    assert.throws(() => assertTrustedRuntime({ [key]: TOKEN }, []), /^Error: UNSAFE_RUNTIME_ENVIRONMENT$/);
  }
  assert.throws(() => assertTrustedRuntime({}, ["--import", TOKEN]), /^Error: UNSAFE_RUNTIME_ENVIRONMENT$/);
  assert.doesNotThrow(() => assertTrustedRuntime({}, []));
});
test("ordinary candidate-local approval is disabled even with valid command arguments", async t => {
  const f = await pair(t); let output = "";
  const before = await fingerprint(f.candidate.root, f.candidate.statePath);
  assert.equal(await runCli(["approve-refinement", ID, "--evidence", URL], { repoRoot: f.candidate.root, stderr: text => { output += text; } }), 2);
  assert.match(output, /candidate-local approval is disabled/);
  assert.deepEqual(await fingerprint(f.candidate.root, f.candidate.statePath), before);
});
test("trusted entrypoint strictly parses all explicit identities and never echoes secrets", async () => {
  const args = [ID, "--evidence", URL, "--candidate-root", "/candidate", "--candidate-head", "a".repeat(40), "--launcher-commit", "b".repeat(40)];
  assert.equal(parseTrustedArguments(args).candidateHead, "a".repeat(40));
  const bad = [[], args.slice(0, -1), [...args, "--force"], args.map((v, i) => i === 7 ? "--candidate-head" : v),
    args.map((v, i) => i === 4 ? "relative" : v), args.map((v, i) => i === 6 ? "A".repeat(40) : v), args.map((v, i) => i === 8 ? TOKEN : v)];
  for (const input of bad) {
    assert.throws(() => parseTrustedArguments(input)); let output = "";
    assert.equal(await runTrustedApproval(input, { stderr: text => { output += text; } }), 2);
    assert.match(output, /Usage/); assert.ok(!output.includes(TOKEN));
  }
  let output = "";
  assert.equal(await runTrustedApproval(args, { stderr: text => { output += text; } }), 1);
  assert.ok(!output.includes(TOKEN)); assert.doesNotMatch(output, /at .*\.ts:/);
});
