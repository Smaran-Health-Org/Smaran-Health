import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { stringify } from "yaml";
import { branchNameIssues, isValidGitBranchName } from "../src/branches.js";
import { validateWorkItem } from "../src/commands/validate.js";
import { loadConfig } from "../src/config.js";
import { stateConsistencyIssues } from "../src/state.js";
import { parseRestrictedYaml } from "../src/validation.js";
import { fixture, ID, syntheticState } from "./helpers.js";

const validNames = [
  "dev-neelesh", "main", "codex/ai-development-pipeline-v1",
  "feature/scheduler-s1-data-model", "release/2026-09",
  "_topic", "feature/-topic", "feature/foo./bar", "feature/foo.locked",
  "feature/foo.LOCK", "feature/foo.lock.more", "feature/@topic",
  "feature/@/topic", "feature/a+b", "feature/a]b", "feature/a{b}",
  "feature/a;b", "feature/a$b", "feature/a`b", "feature/नया", "feature/é",
  "feature/HEAD", "a".repeat(128),
];
const invalidNames = [
  "codex/foo..bar", "codex/foo.lock", "codex/foo/", "codex//foo", "codex/../foo",
  "", "-topic", "HEAD", "@", "/topic", ".topic", ".", "..", "topic.",
  "topic.lock", "topic.lock/topic", "topic.lock.lock/topic", "topic/.hidden",
  "topic/./other", "topic/..", "topic/@{upstream}", "@{-1}",
  ...["~", "^", ":", "?", "*", "[", "\\"].map((character) => `topic/a${character}b`),
  ...Array.from({ length: 33 }, (_, code) => `topic/a${String.fromCharCode(code)}b`),
  "topic/a\x7fb",
];

test("central branch validator enforces Git rules and preserves valid names", () => {
  for (const name of validNames) assert.equal(isValidGitBranchName(name), true, JSON.stringify(name));
  for (const name of invalidNames) assert.equal(isValidGitBranchName(name), false, JSON.stringify(name));
});

test("branch diagnostics omit values and allow an absent optional branch", () => {
  assert.deepEqual(branchNameIssues({ feature_branch: undefined }), []);
  assert.deepEqual(branchNameIssues({ target_branch: "private-value..invalid" }), ["target_branch: Invalid Git branch name."]);
});

test("configuration rejects every invalid branch and accepts representative valid names", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = join(f.root, ".ai-development/pipeline.config.yml");
  const config = parseRestrictedYaml(await readFile(path)) as Record<string, unknown>;
  for (const name of invalidNames) {
    await writeFile(path, stringify({ ...config, target_branch: name }));
    await assert.rejects(loadConfig(f.root), /Invalid pipeline configuration/, JSON.stringify(name));
  }
  for (const name of validNames) {
    await writeFile(path, stringify({ ...config, target_branch: name }));
    assert.equal((await loadConfig(f.root)).target_branch, name);
  }
});

test("state semantic validation checks both target/base and feature branches", () => {
  for (const field of ["target_branch", "feature_branch"] as const) {
    for (const name of invalidNames) {
      const state = syntheticState(); state.repository[field] = name;
      assert.deepEqual(stateConsistencyIssues(state), [`repository.${field}: Invalid Git branch name.`], JSON.stringify(name));
    }
    for (const name of validNames) {
      const state = syntheticState(); state.repository[field] = name;
      assert.deepEqual(stateConsistencyIssues(state), []);
    }
  }
});

test("Work Item validation rejects invalid branches independently of target mismatch", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  for (const field of ["target_branch", "feature_branch"] as const) {
    for (const name of invalidNames) {
      f.state.repository = { identifier: "DrSmaranAI/Smaran-Health", target_branch: "dev-neelesh", [field]: name };
      await f.save();
      const before = await readFile(f.statePath);
      const report = await validateWorkItem(f.root, ID);
      assert.equal(report.valid, false, `${field}: ${JSON.stringify(name)}`);
      assert.match(report.issues.join(" "), /Invalid Git branch name|must NOT have fewer than 1 characters/);
      assert.deepEqual(await readFile(f.statePath), before);
    }
  }
});

test("Work Item validation accepts valid target/base and feature branches", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = join(f.root, ".ai-development/pipeline.config.yml");
  const config = parseRestrictedYaml(await readFile(path)) as Record<string, unknown>;
  for (const name of validNames) {
    await writeFile(path, stringify({ ...config, target_branch: name }));
    f.state.repository.target_branch = name;
    f.state.repository.feature_branch = name;
    await f.save();
    assert.equal((await validateWorkItem(f.root, ID)).valid, true, name);
  }
});

test("configuration and state retain existing branch length and type bounds", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = join(f.root, ".ai-development/pipeline.config.yml");
  const config = parseRestrictedYaml(await readFile(path)) as Record<string, unknown>;
  for (const value of ["a".repeat(129), null, 42]) {
    await writeFile(path, stringify({ ...config, target_branch: value }));
    await assert.rejects(loadConfig(f.root), /Invalid pipeline configuration/);
    await writeFile(path, stringify(config));
    for (const field of ["target_branch", "feature_branch"] as const) {
      const state = syntheticState();
      await writeFile(f.statePath, stringify({ ...state, repository: { ...state.repository, [field]: value } }));
      assert.equal((await validateWorkItem(f.root, ID)).valid, false);
    }
  }
});

test("optional local Git comparison agrees on literal branches", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  // Isolate from checkout history and inherited Git settings; no shell evaluation.
  const options = { cwd: f.root, shell: false, encoding: "utf8" as const, timeout: 5000,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } };
  const version = spawnSync("git", ["--version"], options);
  if ((version.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    t.skip("Local Git is unavailable; production and other tests remain in process."); return;
  }
  assert.ifError(version.error);
  assert.equal(version.status, 0);
  for (const name of [...validNames, ...invalidNames]) {
    // NUL cannot be passed in argv. Lone @ is an explicit stricter pipeline rule.
    if (name.includes("\x00") || name === "@") continue;
    const result = spawnSync("git", ["check-ref-format", "--branch", name], options);
    assert.ifError(result.error);
    assert.equal(result.status === 0, isValidGitBranchName(name), JSON.stringify(name));
  }
  const loneAt = spawnSync("git", ["check-ref-format", "--allow-onelevel", "@"], options);
  assert.ifError(loneAt.error);
  assert.equal(loneAt.status, 1, "Git's generic ref rule prohibits lone @");
});
