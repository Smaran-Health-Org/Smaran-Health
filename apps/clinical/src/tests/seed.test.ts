import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeLocalSeedTarget } from "../db/seed";

test("seed guard permits only explicit localhost targets", () => {
  assert.doesNotThrow(() => assertSafeLocalSeedTarget("http://127.0.0.1:54321", "1"));
  assert.throws(() => assertSafeLocalSeedTarget("https://project.supabase.co", "1"), /localhost/);
  assert.throws(() => assertSafeLocalSeedTarget("http://localhost:54321", undefined), /SMARAN_LOCAL_SEED/);
});
