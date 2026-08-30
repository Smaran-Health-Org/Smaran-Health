// Gemini API client for structured clinical-note extraction. It uses the
// server-side REST API directly so the browser never receives the API key and
// the app does not need another runtime dependency.

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

const CLINICAL_DRAFT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    chiefComplaint: { type: "string" },
    medicationChanges: { type: "string" },
    investigations: { type: "string" },
    followUpPlan: { type: "string" },
    patientInstructions: { type: "string" },
    uncertainItems: { type: "string" },
  },
  required: [
    "summary",
    "chiefComplaint",
    "medicationChanges",
    "investigations",
    "followUpPlan",
    "patientInstructions",
    "uncertainItems",
  ],
} as const;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof Error && error.message.startsWith("fetch failed")) return true;
  return (
    error instanceof Error &&
    /Gemini API returned (5\d\d|429)/.test(error.message)
  );
}

async function requestGenerateContent(model: string, body: object): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to apps/clinical/.env.local."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(
      `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function geminiGenerateClinicalDraft(input: {
  system: string;
  user: string;
  model: string;
  maxTokens?: number;
}): Promise<string> {
  const body = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts: [{ text: input.user }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: input.maxTokens ?? 4096,
      responseMimeType: "application/json",
      responseSchema: CLINICAL_DRAFT_RESPONSE_SCHEMA,
    },
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await requestGenerateContent(input.model, body);
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Gemini API returned ${response.status}. ${detail.slice(0, 400)}`
        );
      }

      const data = (await response.json()) as GeminiGenerateContentResponse;
      const content = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!content) {
        const reason =
          data.promptFeedback?.blockReason ??
          data.candidates?.[0]?.finishReason ??
          "empty response";
        throw new Error(`Gemini returned no draft (${reason}).`);
      }

      return content;
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Gemini API timed out after 60 seconds. Please retry.");
        }
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini request failed.");
}
