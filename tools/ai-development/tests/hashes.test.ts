import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashArtifact, sha256 } from "../src/hashes.js";
import { briefBytes, fixture, ID } from "./helpers.js";

test("SHA-256 has a known deterministic result and preserves byte differences", () => {
  assert.equal(sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(Buffer.from("abc")), sha256(new Uint8Array([97, 98, 99])));
  assert.notEqual(sha256(Buffer.from("abc\n")), sha256(Buffer.from("abc\r\n")));
  assert.notEqual(sha256(Buffer.from([0xff])), sha256(Buffer.from([0xfe])));
});

test("file hashing reads exact bounded bytes through the safety layer", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const path = `.ai-development/work-items/${ID}/BRIEF.md`;
  assert.equal(await hashArtifact(f.root, path, 1024), sha256(briefBytes));
  await writeFile(join(f.directory, "BRIEF.md"), Buffer.from([0xff, 0, 1]));
  assert.equal(await hashArtifact(f.root, path, 1024), sha256(Buffer.from([0xff, 0, 1])));
});
