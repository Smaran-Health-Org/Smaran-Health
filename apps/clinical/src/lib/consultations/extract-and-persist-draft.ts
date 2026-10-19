import type { NoteContent } from "../db/clinical-notes";
import type { ExtractionResult } from "../ai/extract-clinical-note";

/** Persistence failures must never be treated as provider failures or retried
 * with replacement content. Both successful AI and fallback use the same guard. */
export async function extractAndPersistDraft<T>(rawText: string, dependencies: {
  extract: (text: string) => Promise<ExtractionResult>;
  persist: (draft: NoteContent, metadata: Record<string, unknown>) => Promise<T>;
}): Promise<{ persisted: T; fallback: boolean }> {
  let draft: NoteContent;
  let metadata: Record<string, unknown>;
  let fallback = false;
  try {
    const extraction = await dependencies.extract(rawText);
    draft = extraction.draft;
    metadata = { provider: extraction.provider, model: extraction.model,
      promptVersion: extraction.promptVersion, fallbackUsed: extraction.fallbackUsed };
  } catch {
    fallback = true;
    const notExtracted = "Not extracted — AI was unavailable.";
    draft = { summary: rawText.slice(0, 4500), chiefComplaint: notExtracted,
      medicationChanges: notExtracted, investigations: notExtracted,
      followUpPlan: notExtracted, patientInstructions: notExtracted, uncertainItems: notExtracted };
    metadata = { fallbackUsed: true, transcriptFallback: true };
  }
  return { persisted: await dependencies.persist(draft, metadata), fallback };
}
