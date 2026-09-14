import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhTransport } from "../src/github.js";
import { BOOTSTRAP } from "../src/bootstrap.js";

// Synthetic executable replaces gh, records arguments only (never credentials).
async function fakeGh() {
  const root = await mkdtemp(join(tmpdir(), "smaran-fake-gh-"));
  const log = join(root, "requests.jsonl");
  const executable = `#!${process.execPath}\n` + `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, host: process.env.GH_HOST, debug: process.env.GH_DEBUG, explicitToken: process.env.GH_TOKEN === "fake-explicit-verifier-token", ambientTokenAbsent: process.env.GITHUB_TOKEN === undefined, privateConfig: process.env.GH_CONFIG_DIR !== process.env.HOME && fs.readdirSync(process.env.GH_CONFIG_DIR).length === 0 }) + "\\n");
if (process.env.SMARAN_TEST_GH_MODE === "fail") { process.stderr.write(process.env.GH_TOKEN + " private-secret-token HTTP headers"); process.exit(1); }
if (process.env.SMARAN_TEST_GH_MODE === "malformed") { process.stdout.write(process.env.GH_TOKEN + " private-secret-token"); process.exit(0); }
if (process.env.SMARAN_TEST_GH_MODE === "oversized") { process.stdout.write("x".repeat(5 * 1024 * 1024)); }
else if (args.some(a => a.includes("/contents/"))) process.stdout.write(JSON.stringify({ type:"file",path:"source.md",encoding:"base64",content:"eA==\\n",size:1 }));
else process.stdout.write("{}");
`;
  await writeFile(join(root, "gh"), executable, { mode: 0o755 });
  const prior = { PATH: process.env.PATH, GH_DEBUG: process.env.GH_DEBUG, GH_TOKEN: process.env.GH_TOKEN, SMARAN_TEST_GH_MODE: process.env.SMARAN_TEST_GH_MODE };
  process.env.PATH = `${root}:${process.env.PATH}`;
  process.env.GH_DEBUG = "api"; process.env.GH_TOKEN = "synthetic-secret-never-log";
  return { log, cleanup: async () => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); } };
}
test("fixed validated read-only gh operations; shell-free arguments, pinned host/version, no credential/debug logging", async (t) => {
  const f = await fakeGh(); t.after(f.cleanup);
  const gh = new GhTransport(BOOTSTRAP.repository, { verifierToken: "fake-explicit-verifier-token" }); const sha = "a".repeat(40);
  await gh.repository(); await gh.branch("codex/test"); await gh.pull("1"); await gh.comment("2");
  await gh.commentIntegrity("IC_synthetic"); await gh.commit(sha); await gh.permission("ExampleHuman");
  await gh.ancestry(sha, sha); assert.equal((await gh.file(sha, "source.md")).toString(), "x");
  const log = await readFile(f.log, "utf8"); const requests = log.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(requests.length, 9); assert.doesNotMatch(log, /synthetic-secret-never-log|fake-explicit-verifier-token/);
  for (const [index, request] of requests.entries()) {
    assert.deepEqual(request.args.slice(0, 6), ["api", "--hostname", "github.com", "--method", index === 4 ? "POST" : "GET", "-H"]);
    assert.ok(request.args.includes("X-GitHub-Api-Version: 2022-11-28")); assert.equal(request.debug, ""); assert.equal(request.host, "github.com"); assert.equal(request.explicitToken, true); assert.equal(request.ambientTokenAbsent, true); assert.equal(request.privateConfig, true);
  }
  assert.ok(requests[1].args.includes(`repos/${BOOTSTRAP.repository}/branches/codex%2Ftest`));
  const graph = requests[4].args.find((arg: string) => arg.startsWith("query="));
  assert.match(graph, /^query=query\(/); assert.doesNotMatch(graph, /mutation/);
  assert.match(graph, /pullRequest\{number repository\{nameWithOwner\}\}/);
});
for (const mode of ["fail", "malformed", "oversized"]) test(`GitHub ${mode} response is sanitized and fails closed`, async (t) => {
  const f = await fakeGh(); t.after(f.cleanup); process.env.SMARAN_TEST_GH_MODE = mode;
  await assert.rejects(new GhTransport(BOOTSTRAP.repository, { verifierToken: "fake-explicit-verifier-token" }).repository(), (error: unknown) => error instanceof Error && /^GITHUB_(UNAVAILABLE|MALFORMED_RESPONSE)$/.test(error.message));
});
test("transport rejects arbitrary endpoints/URLs, methods and malformed identities before invocation", async () => {
  assert.throws(() => new GhTransport("https://evil.example", { verifierToken: "fake-explicit-verifier-token" })); const gh = new GhTransport(BOOTSTRAP.repository, { verifierToken: "fake-explicit-verifier-token" });
  for (const operation of [() => gh.branch("../evil"), () => gh.pull("1?x=y"), () => gh.comment("0"), () => gh.commentIntegrity("node\nmutation"),
    () => gh.commit("short"), () => gh.permission("-bad"), () => gh.ancestry("short", "a".repeat(40))]) assert.throws(operation);
  await assert.rejects(gh.file("a".repeat(40), "../outside"));
});

test("explicit technical credential is required even with ambient gh authentication", () => {
  const prior = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "fake-ambient-human-session";
  try {
    for (const verifierToken of [undefined, "", "fake token\n"]) assert.throws(() => new GhTransport(BOOTSTRAP.repository, { verifierToken }), /^Error: EXPLICIT_VERIFIER_CREDENTIAL_REQUIRED$/);
  } finally { if (prior === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prior; }
});
