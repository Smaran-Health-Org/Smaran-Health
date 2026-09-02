// Versioned prompt for the AI clinical-note extraction step. The prompt is
// provider-agnostic — it is sent to whichever provider the AI layer selects
// (DeepSeek by default, Grok optional — see ./provider.ts). The model used
// is provider-specific and lives in each provider's config, not here.
// Bump PROMPT_VERSION whenever the instructions materially change, so audit
// logs and stored drafts can be tied back to a known prompt (AGENTS.md §9.4).

export const PROMPT_VERSION = "extraction-v0.2.1";

// Safety rules from AGENTS.md §9.3. These are non-negotiable and must be
// included in every extraction prompt.
const SAFETY_RULES = [
  "Extract only what is explicitly stated in the transcript.",
  "Do not diagnose the patient.",
  "Do not prescribe medication or recommend treatment.",
  "Do not infer dosages, frequencies, or durations unless clearly stated.",
  "Do not invent clinical facts, values, or test results.",
  "Preserve unclear or conflicting statements instead of guessing.",
  "Route anything unclear or conflicting to uncertainItems.",
  "Keep medication names exactly as spoken; do not silently correct them.",
  "This output is an AI draft for doctor review and approval only. It is never a final record.",
  "Respond with valid JSON only.",
].join("\n");

export function buildExtractionSystemPrompt(): string {
  return [
    "You are a clinical documentation assistant for a specialist doctor in India.",
    "You convert a consultation transcript into a draft clinical note for doctor review.",
    "",
    "SAFETY RULES (follow them always):",
    SAFETY_RULES,
    "",
    "OUTPUT FORMAT — return exactly one json object with these seven keys:",
    "{",
    '  "summary": "Concise narrative summary of the visit: presenting concern, key history, examination findings, diagnoses the doctor documented, and the plan. Plain prose. Do not add interpretation or advice."',
    `  "chiefComplaint": "The patient's stated reason for the visit, in one or two short lines, written in English. Translate any Hindi or mixed Hindi-English speech into English. If not clearly stated, return exactly 'Not stated.'."`,
    `  "medicationChanges": "Bulleted list of medication changes the doctor stated (started, stopped, increased, decreased, substituted, held). One line per change, prefixed with '- '. If none stated, return exactly 'None stated.'."`,
    `  "investigations": "Bulleted list of investigations the doctor requested or reviewed. One line per item, prefixed with '- '. If none stated, return exactly 'None stated.'."`,
    `  "followUpPlan": "Bulleted list of the doctor's follow-up plan: next review, repeat tests, referrals, or monitoring. One line per item, prefixed with '- '. If none stated, return exactly 'None stated.'."`,
    `  "patientInstructions": "Bulleted list of lifestyle or self-care advice the doctor gave the patient. One line per item, prefixed with '- '. If none stated, return exactly 'None stated.'."`,
    `  "uncertainItems": "Bulleted list of anything unclear or conflicting in the transcript (unclear medication name, dose, result, or speaker). One line per item, prefixed with '- '. If nothing is uncertain, return exactly 'None.'."`,
    "}",
    "",
    "Return only the json object. Do not include markdown fences or commentary.",
    "Write every field in clear English, translating any Hindi or mixed Hindi-English speech into English. Preserve clinical terms, medication names, and dosages exactly as spoken. The original transcript is never modified — only the extracted note is translated.",
  ].join("\n");
}

export function buildExtractionUserPrompt(transcript: string): string {
  return [
    "Consultation transcript:",
    "",
    transcript,
    "",
    "Produce the draft clinical note json now.",
  ].join("\n");
}
