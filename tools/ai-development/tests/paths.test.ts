import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateWorkItem } from "../src/commands/validate.js";
import { assertArtifactPath, assertRelativePath, assertWorkItemId, existingPipelinePath } from "../src/paths.js";
import { fixture, ID } from "./helpers.js";

test("normal IDs work; traversal, paths, malformed and shell-shaped IDs do not", () => {
  for (const id of [ID, "SCH-S1", "DOMAIN-PHASE-01"]) assert.doesNotThrow(() => assertWorkItemId(id));
  for (const id of ["..", "../TEST-001", "/TEST-001", "C:\\TEST-001", "test-001", "TEST", "TEST--001", "-TEST", "--help", "TEST-001;echo", "$(echo)", "TEST-001\n", "A-" + "B".repeat(64)]) assert.throws(() => assertWorkItemId(id));
});

test("artifact paths must stay inside the requested item without normalization tricks", () => {
  assert.doesNotThrow(() => assertArtifactPath(`.ai-development/work-items/${ID}/BRIEF.md`, ID));
  for (const path of ["/tmp/BRIEF.md", "C:/BRIEF.md", ".ai-development/../secret", `.ai-development/work-items/${ID}/../OTHER/BRIEF.md`, ".ai-development/work-items/OTHER-001/BRIEF.md", ".ai-development/templates/BRIEF.md", `.ai-development/work-items/${ID}//BRIEF.md`, `.ai-development/work-items/${ID}/./BRIEF.md`, `.ai-development/work-items/${ID}/%2e%2e/secret`, ".ai-development\\secret"]) assert.throws(() => assertArtifactPath(path, ID), Error, path);
  assert.throws(() => assertRelativePath("a/" + "x".repeat(256)));
});

test("symlinked artifacts and ancestor directories fail without reading external bytes", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const outside = join(f.root, "outside");
  await mkdir(outside); await writeFile(join(outside, "BRIEF.md"), "external synthetic bytes");
  await rm(join(f.directory, "BRIEF.md"));
  await symlink(join(outside, "BRIEF.md"), join(f.directory, "BRIEF.md"));
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /Symlinks/);
  await rm(f.directory, { recursive: true });
  await symlink(outside, f.directory);
  await assert.rejects(existingPipelinePath(f.root, `.ai-development/work-items/${ID}/BRIEF.md`), /Symlinks/);
});

test("internal symlinks, symlinked pipeline root and non-regular files are also rejected", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await symlink("BRIEF.md", join(f.directory, "ALIAS.md"));
  await assert.rejects(existingPipelinePath(f.root, `.ai-development/work-items/${ID}/ALIAS.md`), /Symlinks/);
  await rm(join(f.directory, "BRIEF.md")); await mkdir(join(f.directory, "BRIEF.md"));
  assert.match((await validateWorkItem(f.root, ID)).issues.join(" "), /regular file/);
  const pipeline = join(f.root, ".ai-development");
  await rm(pipeline, { recursive: true });
  await mkdir(join(f.root, "other")); await symlink(join(f.root, "other"), pipeline);
  await assert.rejects(existingPipelinePath(f.root, ".ai-development/pipeline.config.yml"), /Symlinks/);
});
