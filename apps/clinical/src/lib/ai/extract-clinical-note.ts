import { z } from "zod";
import { runWithAiFallback, type AiProvider } from "./provider";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  PROMPT_VERSION,
} from "./prompts";

// The draft shape the selected provider returns. It matches the flat
// `NoteContent` the pilot editor already uses (summary / medicationChanges /
// investigations / uncertainItems). The full evidence-linked schema at
// docs/schemas/clinical-note-schema/v0.1.0 is the planned follow-up contract.
export const aiDraftSchema = z.object({
  summary: z.string().min(1).max(5000),
  chiefComplaint: z.string().max(5000),
  medicationChanges: z.string().max(5000),
  investigations: z.string().max(5000),
  followUpPlan: z.string().max(5000),
  patientInstructions: z.string().max(5000),
  uncertainItems: z.string().max(5000),
});

export type AiDraft = z.infer<typeof aiDraftSchema>;

export type ExtractionResult = {
  draft: AiDraft;
  provider: "deepseek" | "grok";
  model: string;
  promptVersion: string;
  fallbackUsed: boolean;
};

// Runs the full extraction (chat call + JSON parse + schema validation) on
// the primary provider, and automatically retries on the fallback provider
// when the primary is unavailable or returns unusable output. The provider
// that actually produced the draft is returned for audit purposes.
export async function extractClinicalDraft(
  transcript: string
): Promise<ExtractionResult> {
  const extraction = await runWithAiFallback(async (provider: AiProvider) => {
    const raw = await provider.chatJson({
      system: buildExtractionSystemPrompt(),
      user: buildExtractionUserPrompt(transcript),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The AI returned invalid JSON. Please retry.");
    }

    const result = aiDraftSchema.safeParse(parsed);
    if (!result.success) {
      // Never auto-approve or guess — surface a safe, retryable failure.
      throw new Error("The AI draft failed validation. Please retry.");
    }

    return result.data;
  });

  return {
    draft: extraction.result,
    provider: extraction.provider,
    model: extraction.model,
    promptVersion: PROMPT_VERSION,
    fallbackUsed: extraction.fallbackUsed,
  };
}
