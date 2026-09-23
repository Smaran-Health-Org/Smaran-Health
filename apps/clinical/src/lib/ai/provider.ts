// AI provider selection + failover.
//
// Two OpenAI-compatible providers are supported: DeepSeek (default) and
// Grok (xAI). Switching providers is deliberately a one-line change:
//
//   Option A (recommended — no code edit, works on Vercel too):
//     AI_PROVIDER=auto      (default) Grok is primary when GROK_API_KEY is
//                                     set, otherwise DeepSeek. The other
//                                     provider is the automatic fallback.
//     AI_PROVIDER=deepseek  Force DeepSeek (Grok becomes the fallback).
//     AI_PROVIDER=grok      Force Grok (DeepSeek becomes the fallback).
//
//   Option B (code toggle): change DEFAULT_AI_PROVIDER below and redeploy.
//
// Failover: whenever the primary provider is unavailable — missing key,
// network error, timeout, HTTP 5xx/429, empty response, invalid JSON, or a
// draft that fails schema validation — the call is retried once on the
// fallback provider (when one exists). The provider actually used is
// returned so audit logs record it per note (AGENTS.md §9.4). A PHI-safe
// warning (provider ids + error class only) is logged on every failover.

import { DEEPSEEK_CONFIG, deepseekChatJson } from "./deepseek";
import { GROK_CONFIG, grokChatJson } from "./grok";
import { isApiKeyConfigured } from "./openai-compatible";
import { logWarn } from "@/lib/logger";

export type AiProviderId = "deepseek" | "grok";

export type AiProvider = {
  id: AiProviderId;
  model: string;
  chatJson: (input: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<string>;
};

export type AiProviderMode = "auto" | AiProviderId;

// ── Config ────────────────────────────────────────────────────────────────
// Code-level default; overridden by the AI_PROVIDER env var when set.
// Change this constant to "deepseek" or "grok" as the one-line code toggle.
export const DEFAULT_AI_PROVIDER: AiProviderMode = "auto";

const PROVIDERS: Record<AiProviderId, AiProvider> = {
  deepseek: {
    id: "deepseek",
    model: DEEPSEEK_CONFIG.defaultModel,
    chatJson: deepseekChatJson,
  },
  grok: {
    id: "grok",
    model: GROK_CONFIG.defaultModel,
    chatJson: grokChatJson,
  },
};

export type AiProviderSelection = {
  mode: AiProviderMode;
  primary: AiProvider;
  fallback: AiProvider | null;
};

export function resolveAiProviders(): AiProviderSelection {
  const envMode = (process.env.AI_PROVIDER ?? DEFAULT_AI_PROVIDER)
    .trim()
    .toLowerCase();
  const mode: AiProviderMode =
    envMode === "deepseek" || envMode === "grok" ? envMode : "auto";

  if (mode === "auto") {
    // Prefer Grok when its key exists; otherwise DeepSeek. The provider not
    // chosen becomes the fallback (or null when only one key is configured).
    const grokReady = isApiKeyConfigured(GROK_CONFIG);
    const deepseekReady = isApiKeyConfigured(DEEPSEEK_CONFIG);

    if (grokReady) {
      return {
        mode,
        primary: PROVIDERS.grok,
        fallback: deepseekReady ? PROVIDERS.deepseek : null,
      };
    }
    return {
      mode,
      primary: PROVIDERS.deepseek,
      fallback: null,
    };
  }

  // Forced mode: the selected provider is primary; the other is the
  // fallback. If the fallback's key is missing, its call fails fast with a
  // clear message instead of hanging.
  return {
    mode,
    primary: PROVIDERS[mode],
    fallback: PROVIDERS[mode === "deepseek" ? "grok" : "deepseek"],
  };
}

export type AiCallResult<T> = {
  result: T;
  provider: AiProviderId;
  model: string;
  fallbackUsed: boolean;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `run(provider)` on the primary provider; on any failure, retries once
 * on the fallback provider (when one exists). Returns the result plus which
 * provider/model actually produced it. Never auto-approves anything — the
 * caller decides what to do with the result (AGENTS.md §8).
 */
export async function runWithAiFallback<T>(
  run: (provider: AiProvider) => Promise<T>
): Promise<AiCallResult<T>> {
  const { mode, primary, fallback } = resolveAiProviders();

  try {
    const result = await run(primary);
    return {
      result,
      provider: primary.id,
      model: primary.model,
      fallbackUsed: false,
    };
  } catch (primaryError) {
    if (!fallback) throw primaryError;

    logWarn("ai.provider_fallback", {
      mode,
      primary: primary.id,
      fallback: fallback.id,
      reason: messageOf(primaryError).slice(0, 300),
    });

    try {
      const result = await run(fallback);
      return {
        result,
        provider: fallback.id,
        model: fallback.model,
        fallbackUsed: true,
      };
    } catch (fallbackError) {
      throw new Error(
        `AI providers unavailable. ${primary.id}: ${messageOf(primaryError)} | ${fallback.id}: ${messageOf(fallbackError)}`
      );
    }
  }
}

/** Convenience wrapper: chat JSON through the provider with failover. */
export function aiChatJson(input: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<AiCallResult<string>> {
  return runWithAiFallback((provider) => provider.chatJson(input));
}
