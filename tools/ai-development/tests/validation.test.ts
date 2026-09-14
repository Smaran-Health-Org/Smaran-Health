import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { stringify } from "yaml";
import { loadConfig } from "../src/config.js";
import { validateWorkItem } from "../src/commands/validate.js";
import { createSchemaValidator, MAX_YAML_BYTES, parseRestrictedYaml, schemaIssues } from "../src/validation.js";
import { STATES } from "../src/state.js";
import { fixture, ID, repositoryRoot, schema, syntheticState } from "./helpers.js";

test("all supported state fixtures satisfy the strict JSON schema", async () => {
  const validate = createSchemaValidator(await schema("state"));
  for (const state of STATES) assert.deepEqual(schemaIssues(validate, syntheticState(state)), []);
});

test("restricted YAML rejects dangerous or ambiguous input without echoing values", () => {
  const invalid = ["value: [", "value: 1\nvalue: 2", "a: 1\n---\nb: 2", "a: !unsafe private-secret", "a: &anchor 1", "a: *missing", "a:\n  <<: { x: 1 }", "a: !!str 1", "[a, b]: 1", "a: .inf", "%YAML 1.1\n---\na: yes", "", "# comment only\n"];
  for (const source of invalid) assert.throws(() => parseRestrictedYaml(Buffer.from(source)), Error, source);
  assert.throws(() => parseRestrictedYaml(Buffer.from("a: !unsafe private-secret")), (error: unknown) => error instanceof Error && !error.message.includes("private-secret"));
});

test("YAML is UTF-8, byte-bounded and depth-bounded; quoted special characters are data", () => {
  assert.throws(() => parseRestrictedYaml(Buffer.from([0xff])));
  assert.throws(() => parseRestrictedYaml(Buffer.alloc(MAX_YAML_BYTES + 1)));
  assert.throws(() => parseRestrictedYaml(Buffer.from("[".repeat(40) + "0" + "]".repeat(40))));
  assert.deepEqual(parseRestrictedYaml(Buffer.from('a: "literal *alias &anchor !tag"\n')), { a: "literal *alias &anchor !tag" });
});

test("schema rejects wrong types, versions, fields and fabricated pending approval", async () => {
  const validate = createSchemaValidator(await schema("state"));
  for (const mutate of [
    (state: Record<string, unknown>) => { state.extra = true; },
    (state: Record<string, unknown>) => { state.revision = "0"; },
    (state: Record<string, unknown>) => { state.schema_version = "ai-development-state/v999"; },
    (state: Record<string, unknown>) => { state.state = "implementing"; },
    (state: Record<string, unknown>) => { state.gates = { refinement: { status: "pending", approval: {} }, plan: { status: "pending" } }; },
  ]) {
    const state = structuredClone(syntheticState()) as unknown as Record<string, unknown>;
    mutate(state);
    const before = structuredClone(state);
    assert.equal(validate(state), false);
    assert.deepEqual(state, before, "validator must not coerce/default/remove input");
  }
});

test("approved gate metadata must include human actor, timestamp, hash, commit and evidence", async () => {
  const validate = createSchemaValidator(await schema("state"));
  for (const key of ["actor", "at", "artifact_sha256", "artifact_commit", "evidence"]) {
    const state = syntheticState("refinement_approved");
    delete (state.gates.refinement.approval as unknown as Record<string, unknown>)[key];
    assert.equal(validate(state), false, key);
  }
  const state = syntheticState("refinement_approved");
  (state.gates.refinement.approval!.actor as { kind: string }).kind = "agent";
  assert.equal(validate(state), false);
});

test("template is structurally valid, uninitialized and pending", async () => {
  const template = await readFile(join(repositoryRoot, ".ai-development/templates/STATE.yml"));
  const raw = parseRestrictedYaml(template);
  const validate = createSchemaValidator(await schema("state"));
  assert.equal(validate(raw), true);
  assert.equal((raw as ReturnType<typeof syntheticState>).state, "refinement_pending");
  assert.deepEqual((raw as ReturnType<typeof syntheticState>).gates, { refinement: { status: "pending" }, plan: { status: "pending" } });
});

test("valid ready Work Item validates read-only; changed hash and missing artifacts fail", async (t) => {
  const f = await fixture(syntheticState("plan_ready")); t.after(f.cleanup);
  const before = await readFile(f.statePath);
  assert.equal((await validateWorkItem(f.root, ID)).valid, true);
  assert.deepEqual(await readFile(f.statePath), before);
  await writeFile(join(f.directory, "BRIEF.md"), "changed synthetic bytes");
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /SHA-256 does not match/);
  await rm(join(f.directory, "PLAN.md"));
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /not found/);
  assert.deepEqual(await readFile(f.statePath), before);
});

test("source references are metadata only but traversal is rejected", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  f.state.sources = [{ path: "docs/nonexistent-synthetic.md", selector: { kind: "heading", value: "Synthetic heading" } }];
  await f.save();
  assert.equal((await validateWorkItem(f.root, ID)).valid, true, "Stage 2A must not resolve source content");
  f.state.sources[0]!.path = "../outside";
  await f.save();
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /Source reference: Unsafe path/);
});

test("matching artifact bytes do not rescue a mismatched recorded gate binding", async (t) => {
  const f = await fixture(syntheticState("refinement_approved")); t.after(f.cleanup);
  f.state.gates.refinement.approval!.artifact_sha256 = "b".repeat(64);
  await f.save();
  const report = await validateWorkItem(f.root, ID);
  assert.equal(report.valid, false);
  assert.match(report.issues.join(" "), /approval must bind/);
  assert.equal(report.artifacts[0]!.hash, "matched");
});

test("schema-valid missing state-dependent data and mismatched IDs/repositories fail", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  f.state.state = "plan_ready";
  f.state.work_item_id = "TEST-OTHER";
  f.state.repository.identifier = "example/wrong";
  f.state.repository.target_branch = "wrong";
  await f.save();
  const report = await validateWorkItem(f.root, ID);
  assert.equal(report.valid, false);
  assert.match(report.issues.join(" "), /ID does not match/);
  assert.match(report.issues.join(" "), /repository does not match/);
  assert.match(report.issues.join(" "), /target branch/);
  assert.match(report.issues.join(" "), /plan artifact/);
});

test("configuration cannot expand hard roots, states or resource limits", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = join(f.root, ".ai-development/pipeline.config.yml");
  const config = parseRestrictedYaml(await readFile(path)) as Record<string, unknown>;
  for (const field of ["artifact_root", "work_item_root", "supported_states", "policy"]) {
    const changed = structuredClone(config);
    changed[field] = field === "supported_states" ? ["implementing"] : field === "policy" ? { max_yaml_bytes: 9999999, max_artifact_bytes: 9999999, max_depth: 100 } : "../outside";
    await writeFile(path, stringify(changed));
    await assert.rejects(loadConfig(f.root), /Invalid pipeline configuration/);
  }
});

test("oversized YAML/config/artifact files are rejected at read boundaries", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(join(f.directory, "BRIEF.md"), Buffer.alloc(1_048_577));
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /byte limit/);
  await writeFile(f.statePath, Buffer.alloc(MAX_YAML_BYTES + 1));
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /byte limit/);
  await writeFile(join(f.root, ".ai-development/pipeline.config.yml"), Buffer.alloc(MAX_YAML_BYTES + 1));
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /byte limit/);
});
