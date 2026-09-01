// Grok (xAI) API client — an OpenAI-compatible provider.
//
// Docs: https://docs.x.ai
// Text models: grok-4.6 ($2.00/$6.00 per 1M in/out), grok-4.3 ($1.25/$2.50,
// 1M context). JSON mode (`response_format: json_object`) is supported on
// Grok chat models, so the shared client in ./openai-compatible.ts works
// unchanged.
//
// The key is a PLACEHOLDER for now: leave GROK_API_KEY empty (or set to a
// dummy value) and the provider layer in ./provider.ts automatically falls
// back to DeepSeek whenever Grok is unavailable.

import { createChatJson, type AiMessage } from "./openai-compatible";

export type GrokMessage = AiMessage;

export const GROK_CONFIG = {
  providerName: "grok",
  baseUrl: "https://api.x.ai",
  envKey: "GROK_API_KEY",
  defaultModel: "grok-4.3",
} as const;

export const grokChatJson = createChatJson(GROK_CONFIG);
