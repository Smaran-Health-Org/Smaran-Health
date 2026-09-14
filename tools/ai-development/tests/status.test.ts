import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { formatStatus } from "../src/commands/status.js";
import { validateWorkItem } from "../src/commands/validate.js";
import { fixture, ID, repositoryRoot, syntheticState } from "./helpers.js";

test("status reports recorded state, local validation limits and the correct conceptual action", async (t) => {
  for (const [state, action] of [["refinement_pending", "human refinement approval"], ["refinement_approved", "planning"], ["planning", "complete and validate"], ["plan_ready", "human plan approval"], ["plan_approved", "stop;"]] as const) {
    const f = await fixture(syntheticState(state)); t.after(f.cleanup);
    let output = "";
    assert.equal(await runCli(["status", ID], { repoRoot: f.root, stdout: (text) => { output += text; } }), 0);
    assert.match(output, new RegExp(`RECORDED STATE: ${state}`));
    assert.ok(output.includes(`Next conceptual action: ${action}`));
    assert.match(output, /not verified in Stage 2A/);
    assert.match(output, /VALIDATION: PASS/);
  }
});

test("invalid recorded gate retains its state, fails and reports blockers before any next action", async (t) => {
  const f = await fixture(syntheticState("refinement_approved")); t.after(f.cleanup);
  f.state.gates.refinement = { status: "invalidated", invalidation_reason: "Synthetic changed artifact" };
  await f.save();
  const before = await readFile(f.statePath);
  const output = formatStatus(await validateWorkItem(f.root, ID));
  assert.match(output, /RECORDED STATE: refinement_approved/);
  assert.match(output, /BLOCKERS:/);
  assert.match(output, /no advancement permitted/);
  assert.deepEqual(await readFile(f.statePath), before);
  assert.equal(await runCli(["status", ID], { repoRoot: f.root, stdout: () => {} }), 1);
});

test("missing Work Item and invalid synthetic YAML return nonzero exits without stack traces", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  for (const command of ["status", "validate"]) {
    let output = "";
    const io = { repoRoot: f.root, stdout: (text: string) => { output += text; }, stderr: (text: string) => { output += text; } };
    assert.equal(await runCli([command, "MISSING-001"], io), 1);
    assert.match(output, /not found/);
    assert.doesNotMatch(output, /at .*\.ts:/);
    await writeFile(f.statePath, "a: [");
    assert.equal(await runCli([command, ID], io), 1);
    assert.match(output, /Malformed YAML/);
  }
});

test("only two commands are exposed, with strict positional arguments", async () => {
  for (const args of [[], ["plan", ID], ["approve-plan", ID], ["implement", ID], ["status"], ["status", ID, "--json"]]) {
    let error = "";
    assert.equal(await runCli(args, { stderr: (text) => { error += text; } }), 2);
    assert.ok(error.includes("Usage") || error.includes("Available commands"));
  }
});

test("actual CLI subprocess discovers the root and returns appropriate process exit codes", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const tool = join(repositoryRoot, "tools/ai-development");
  const launch = (args: string[]) => spawnSync(process.execPath, ["--import", join(tool, "node_modules/tsx/dist/loader.mjs"), join(tool, "src/cli.ts"), ...args], { cwd: f.root, encoding: "utf8", env: { PATH: process.env.PATH } });
  const before = await readFile(f.statePath);
  const valid = launch(["validate", ID]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /validation passed/);
  const missing = launch(["validate", "MISSING-001"]);
  assert.equal(missing.status, 1);
  const unsupported = launch(["plan", ID]);
  assert.equal(unsupported.status, 2);
  const status = launch(["status", ID]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /human refinement approval/);
  assert.deepEqual(await readFile(f.statePath), before);
});
