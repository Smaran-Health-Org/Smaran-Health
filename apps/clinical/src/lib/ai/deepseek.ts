// DeepSeek API client. DeepSeek exposes an OpenAI-compatible
// `POST /chat/completions` endpoint, so we talk to it with a plain `fetch`
// instead of adding a new dependency (see AGENTS.md §3.9).
//
// Docs: https://api-docs.deepseek.com
// Models: `deepseek-chat` (general) and `deepseek-reasoner` (reasoning).
// Note: DeepSeek is text-only — it has no audio transcription endpoint.

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
};

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

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model ?? "deepseek-chat",
      messages,
      temperature: input.temperature ?? 0,
      max_tokens: input.maxTokens ?? 4096,
      response_format: { type: "json_object" },
    }),
  });

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
}
