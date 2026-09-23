// Generic OpenAI-compatible chat-completions client built on plain `fetch`
// (no SDK dependency — see AGENTS.md §3.9). Both DeepSeek and xAI/Grok
// expose the same `POST /chat/completions` contract, so one parameterized
// client serves every provider; only the base URL, key env var, and default
// model differ.
//
// Docs:
//   DeepSeek: https://api-docs.deepseek.com
//   xAI/Grok: https://docs.x.ai
//   Grok text models: grok-4.6 ($2.00/$6.00 per 1M in/out), grok-4.3
//   ($1.25/$2.50, 1M context). JSON mode (`response_format: json_object`)
//   is supported on Grok chat models — same contract as DeepSeek.

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type OpenAiCompatibleConfig = {
  /** Short label used in error messages and audit logs (e.g. "deepseek"). */
  providerName: string;
  /** API origin, e.g. "https://api.deepseek.com". */
  baseUrl: string;
  /** Env var holding the API key, e.g. "DEEPSEEK_API_KEY". */
  envKey: string;
  /** Default model id, e.g. "deepseek-chat" or "grok-4.3". */
  defaultModel: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

export function isApiKeyConfigured(config: OpenAiCompatibleConfig): boolean {
  return Boolean(process.env[config.envKey]);
}

// Retryable failures: network errors, timeouts, and 5xx responses. 4xx
// responses (bad key, quota) are not retried — they won't succeed on retry.
// The regex is provider-agnostic because every provider reports the HTTP
// status through the same `API returned <status>` message shape.
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof Error && error.message.startsWith("fetch failed")) {
    return true;
  }
  return (
    error instanceof Error &&
    /API returned (5\d\d|429)/.test(error.message)
  );
}

export type ChatJsonInput = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type ChatJsonFn = (input: ChatJsonInput) => Promise<string>;

export function createChatJson(config: OpenAiCompatibleConfig): ChatJsonFn {
  const requestTimeoutMs =
    config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestChatCompletion(body: object): Promise<Response> {
    const apiKey = process.env[config.envKey];
    if (!apiKey) {
      throw new Error(
        `${config.envKey} is not configured. Add it to apps/clinical/.env.local, or set AI_PROVIDER to a provider whose key exists.`
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetch(`${config.baseUrl}/chat/completions`, {
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

  return async function chatJson(input: ChatJsonInput): Promise<string> {
    const messages: AiMessage[] = [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ];

    const body = {
      model: input.model ?? config.defaultModel,
      messages,
      temperature: input.temperature ?? 0,
      max_tokens: input.maxTokens ?? 4096,
      response_format: { type: "json_object" },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await requestChatCompletion(body);
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(
            `${config.providerName} API returned ${response.status}. ${detail.slice(0, 400)}`
          );
        }

        const data = (await response.json()) as ChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content;

        if (typeof content !== "string" || content.trim().length === 0) {
          throw new Error(`${config.providerName} returned an empty response.`);
        }

        return content;
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt === maxRetries) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error(
              `${config.providerName} API timed out after ${Math.round(requestTimeoutMs / 1000)} seconds. Please retry.`
            );
          }
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${config.providerName} request failed.`);
  };
}
