import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadConfig } from "../src/config.js";
import { createSchemaValidator, parseRestrictedYaml } from "../src/validation.js";
import { fixture, schema, syntheticState } from "./helpers.js";
import type { PipelineConfig } from "../src/config.js";
for (const [label, users, valid] of [
  ["empty disabled", [], true], ["future user", [{ login: "Example-Human", id: "123" }], true],
  ["duplicate login case", [{ login: "Example", id: "1" }, { login: "eXAMPLE", id: "2" }], false],
  ["duplicate ID", [{ login: "Example", id: "1" }, { login: "Other", id: "1" }], false],
  ["malformed login", [{ login: "-bad", id: "1" }], false], ["double hyphen", [{ login: "bad--user", id: "1" }], false],
  ["login too long", [{ login: "x".repeat(40), id: "1" }], false], ["malformed ID", [{ login: "Example", id: "01" }], false],
  ["numeric ID", [{ login: "Example", id: 1 }], false], ["negative ID", [{ login: "Example", id: "-1" }], false],
  ["zero ID", [{ login: "Example", id: "0" }], false], ["list bound", Array.from({ length: 33 }, (_, i) => ({ login: `User${i}`, id: String(i + 1) })), false],
] as const) test(`config V2 ${label}`, async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = join(f.root, ".ai-development/pipeline.config.yml");
  const config = parseRestrictedYaml(await readFile(path)) as PipelineConfig;
  (config.approvals.refinement as unknown as { authorized_github_users: unknown }).authorized_github_users = users;
  await writeFile(path, stringify(config));
  if (valid) assert.equal((await loadConfig(f.root)).schema_version, "ai-development-config/v2");
  else await assert.rejects(loadConfig(f.root));
});
for (const version of ["v1", "v3"]) test(`config rejects ${version}`, async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = join(f.root, ".ai-development/pipeline.config.yml");
  await writeFile(path, (await readFile(path, "utf8")).replace("config/v2", `config/${version}`));
  await assert.rejects(loadConfig(f.root));
});
for (const [label, mutate] of Object.entries({
  "missing body integrity": (s: any) => { delete s.gates.refinement.approval.evidence.body_sha256; },
  "missing update timestamp": (s: any) => { delete s.gates.refinement.approval.evidence.updated_at; },
  "missing verification": (s: any) => { delete s.gates.refinement.approval.verification; },
  "invalid verification version": (s: any) => { s.gates.refinement.approval.verification.version = "refinement-approval/v2"; },
  "invalid stable actor": (s: any) => { s.gates.refinement.approval.actor.id = "human:example"; },
  "state v1": (s: any) => { s.schema_version = "ai-development-state/v1"; },
  "state v3": (s: any) => { s.schema_version = "ai-development-state/v3"; },
})) test(`state V2 rejects ${label}`, async () => {
  const validate = createSchemaValidator(await schema("state"));
  const state = syntheticState("refinement_approved"); mutate(state); assert.equal(validate(state), false);
});
test("pending and approved V2 accepted; schema validity is not authentication", async () => {
  const validate = createSchemaValidator(await schema("state"));
  assert.equal(validate(syntheticState()), true); assert.equal(validate(syntheticState("refinement_approved")), true);
});
