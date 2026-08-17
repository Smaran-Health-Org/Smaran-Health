import { z } from "zod";
import { deepseekChatJson } from "./deepseek";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  MODEL,
  PROMPT_VERSION,
} from "./prompts";

// The draft shape DeepSeek returns. It matches the flat `NoteContent` the
// pilot editor already uses (summary / medicationChanges / investigations /
// uncertainItems). The full evidence-linked schema at
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
  model: string;
  promptVersion: string;
};

export async function extractClinicalDraft(
  transcript: string
): Promise<ExtractionResult> {
  const raw = await deepseekChatJson({
    system: buildExtractionSystemPrompt(),
    user: buildExtractionUserPrompt(transcript),
    model: MODEL,
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

  return {
    draft: result.data,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
  };
}
