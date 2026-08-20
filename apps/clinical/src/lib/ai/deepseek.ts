// DeepSeek API client. DeepSeek exposes an OpenAI-compatible
// `POST /chat/completions` endpoint, so we talk to it with a plain `fetch`
// instead of adding a new dependency (see AGENTS.md §3.9).
//
// Docs: https://api-docs.deepseek.com
// Models: `deepseek-chat` (general) and `deepseek-reasoner` (reasoning).
// Note: DeepSeek is text-only — it has no audio transcription endpoint.

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
};

// Retryable failures: network errors, timeouts, and 5xx responses. 4xx
// responses (bad key, quota) are not retried — they won't succeed on retry.
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof Error && error.message.startsWith("fetch failed")) {
    return true;
  }
  return (
    error instanceof Error &&
    /DeepSeek API returned (5\d\d|429)/.test(error.message)
  );
}

async function requestChatCompletion(body: object): Promise<Response> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not configured. Add it to apps/clinical/.env.local."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function deepseekChatJson(input: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not configured. Add it to apps/clinical/.env.local."
    );
  }

  const messages: DeepSeekMessage[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];

  const body = {
    model: input.model ?? "deepseek-chat",
    messages,
    temperature: input.temperature ?? 0,
    max_tokens: input.maxTokens ?? 4096,
    response_format: { type: "json_object" },
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await requestChatCompletion(body);
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `DeepSeek API returned ${response.status}. ${detail.slice(0, 400)}`
        );
      }

      const data = (await response.json()) as DeepSeekChatCompletion;
      const content = data.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("DeepSeek returned an empty response.");
      }

      return content;
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            "DeepSeek API timed out after 60 seconds. Please retry."
          );
        }
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("DeepSeek request failed.");
}
