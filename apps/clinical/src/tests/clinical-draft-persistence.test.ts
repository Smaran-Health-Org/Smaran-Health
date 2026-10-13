import assert from "node:assert/strict";
import test from "node:test";
import { extractAndPersistDraft } from "../lib/consultations/extract-and-persist-draft";
import { saveClinicalNoteSchema } from "../lib/validation";

const note = { summary: "Synthetic note", chiefComplaint: "", medicationChanges: "", investigations: "",
  followUpPlan: "", patientInstructions: "", uncertainItems: "" };
const extraction = { draft: note, provider: "deepseek" as const, model: "mock", promptVersion: "mock", fallbackUsed: false };

test("a database failure never becomes a second persistence attempt with fallback content", async () => {
  let writes = 0;
  await assert.rejects(() => extractAndPersistDraft("Synthetic transcript", {
    extract: async () => extraction,
    persist: async () => { writes += 1; throw new Error("Synthetic database failure"); },
  }), /Synthetic database failure/);
  assert.equal(writes, 1);
});

test("provider failure persists a reviewable fallback through the same guarded path", async () => {
  const result = await extractAndPersistDraft("Synthetic original transcript", {
    extract: async () => { throw new Error("Synthetic provider failure"); },
    persist: async (draft, metadata) => ({ draft, metadata }),
  });
  assert.equal(result.fallback, true);
  assert.equal(result.persisted.draft.summary, "Synthetic original transcript");
  assert.equal(result.persisted.metadata.fallbackUsed, true);
});

test("human review requires an observed revision and cannot masquerade as AI generation", () => {
  const request = { status: "edited", content: note, summary: note.summary, expectedRevision: null };
  assert.equal(saveClinicalNoteSchema.safeParse(request).success, true);
  assert.equal(saveClinicalNoteSchema.safeParse({ ...request, expectedRevision: 1 }).success, true);
  assert.equal(saveClinicalNoteSchema.safeParse({ ...request, expectedRevision: undefined }).success, false);
  assert.equal(saveClinicalNoteSchema.safeParse({ ...request, status: "ai_draft" }).success, false);
});
