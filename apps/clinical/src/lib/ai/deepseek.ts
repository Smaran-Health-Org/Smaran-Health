// DeepSeek API client — an OpenAI-compatible provider (see ./provider.ts for
// selection + failover). The client logic lives in ./openai-compatible.ts;
// this file only supplies the provider-specific configuration.
//
// Docs: https://api-docs.deepseek.com
// Models: `deepseek-chat` (general) and `deepseek-reasoner` (reasoning).
// Note: DeepSeek is text-only — it has no audio transcription endpoint.

import { createChatJson, type AiMessage } from "./openai-compatible";

export type DeepSeekMessage = AiMessage; // back-compat alias

export const DEEPSEEK_CONFIG = {
  providerName: "deepseek",
  baseUrl: "https://api.deepseek.com",
  envKey: "DEEPSEEK_API_KEY",
  defaultModel: "deepseek-chat",
} as const;

export const deepseekChatJson = createChatJson(DEEPSEEK_CONFIG);
