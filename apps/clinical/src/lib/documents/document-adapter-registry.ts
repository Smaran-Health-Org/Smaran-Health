import "server-only";
import type { DocumentProcessingAdapter } from "./processing-adapter";
import { DocumentProcessingProviderError } from "./processing-adapter";
import type { SupportedDocumentMime } from "./file";
import { DeepSeekDocumentAdapter } from "./deepseek-document-adapter";
import { GeminiDocumentAdapter } from "./gemini-document-adapter";
import { OpenAiDocumentAdapter } from "./openai-document-adapter";
import { logWarn } from "@/lib/logger";

/**
 * Provider registry for medical-document extraction.
 *
 * Adding a provider is one entry here plus one adapter file: the prompt, the
 * response schema and the Zod validation downstream are shared, so a new provider
 * cannot change *what* is extracted, only *how* it is asked.
 *
 * Two knobs, both environment-only so no redeploy is needed to switch:
 *
 *   DOCUMENT_PROCESSING_PROVIDER = gemini | openai | deepseek | auto
 *   DOCUMENT_PROCESSING_MODEL    = provider-specific override
 *
 * Keys (all optional — a provider is used only when its key exists):
 *
 *   GEMINI_API_KEY · OPENAI_API_KEY · DEEPSEEK_API_KEY
 *
 * `auto` (the default) prefers the order below and skips providers with no key.
 *
 * Why this is not a plain "first configured provider wins"
 * -------------------------------------------------------
 * Providers do not have equal reach: DeepSeek accepts images but rejects PDFs
 * (verified against the live API). Picking purely by key presence would silently
 * break every PDF upload the moment someone set only a DeepSeek key. So selection
 * is per-document: the configured provider is tried first, and if it cannot read
 * that MIME type the registry falls through to one that can. A PDF therefore
 * still gets processed when a PDF-capable key exists, and fails with a clear
 * `unsupported_source` — not a corrupted parse — when none does.
 */

type ProviderId = "gemini" | "openai" | "deepseek";

type ProviderSpec = {
  id: ProviderId;
  /** Environment variable holding the credential. */
  keyEnv: string;
  /** Model used when DOCUMENT_PROCESSING_MODEL is not set. */
  defaultModel: string;
  /** Documented preference order for `auto`. */
  rank: number;
  create: (model: string, apiKey: string) => DocumentProcessingAdapter;
};

const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  gemini: {
    id: "gemini",
    keyEnv: "GEMINI_API_KEY",
    // Flash rather than Pro: document extraction is bounded transcription and
    // classification, and the cost difference at pilot volume is the difference
    // between running the pilot and not.
    defaultModel: "gemini-2.5-flash",
    rank: 0,
    create: (model, key) => new GeminiDocumentAdapter(model, key),
  },
  openai: {
    id: "openai",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    rank: 1,
    create: (model, key) => new OpenAiDocumentAdapter(model, key),
  },
  deepseek: {
    id: "deepseek",
    keyEnv: "DEEPSEEK_API_KEY",
    // MUST be an image-capable model. `deepseek-chat` is text-only and would
    // answer about a document it never saw.
    defaultModel: "deepseek-flash",
    rank: 2,
    create: (model, key) => new DeepSeekDocumentAdapter(model, key),
  },
};

export const DOCUMENT_PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

function keyFor(spec: ProviderSpec): string {
  return process.env[spec.keyEnv]?.trim() ?? "";
}

function configuredProviderOrder(): ProviderSpec[] {
  const requested = (process.env.DOCUMENT_PROCESSING_PROVIDER ?? "auto").trim().toLowerCase();

  const ranked = Object.values(PROVIDERS).sort((a, b) => a.rank - b.rank);

  if (requested && requested !== "auto") {
    const chosen = PROVIDERS[requested as ProviderId];
    if (!chosen) {
      // A typo must not silently fall back to a different provider than the
      // operator believes is in use; record it and use the documented order.
      logWarn("documents.provider_unknown", { requested, fallback: "auto" });
      return ranked;
    }
    // Requested provider first, then the rest as capability fallbacks.
    return [chosen, ...ranked.filter((spec) => spec.id !== chosen.id)];
  }

  return ranked;
}

function modelOverride(): string | undefined {
  const value = process.env.DOCUMENT_PROCESSING_MODEL?.trim();
  return value ? value : undefined;
}

/** Every provider that has a credential, in the order we would try them. */
function availableAdapters(): DocumentProcessingAdapter[] {
  const override = modelOverride();
  return configuredProviderOrder()
    .filter((spec) => keyFor(spec) !== "")
    .map((spec) => spec.create(override ?? spec.defaultModel, keyFor(spec)));
}

/**
 * The adapter to use for a document of this type.
 *
 * Returns the first configured provider that can read `mimeType`. Throws
 * `unsupported_source` when credentials exist but none can read it, and
 * `provider_unavailable` when no credential is configured at all — those are
 * different operational problems and deserve different logs.
 */
export function resolveDocumentAdapter(mimeType: SupportedDocumentMime): DocumentProcessingAdapter {
  const adapters = availableAdapters();

  if (adapters.length === 0) {
    logWarn("documents.no_provider_configured", {
      checked: Object.values(PROVIDERS).map((spec) => spec.keyEnv),
    });
    throw new DocumentProcessingProviderError("provider_unavailable");
  }

  const capable = adapters.find((adapter) => adapter.capabilities.accepts.has(mimeType));
  if (capable) return capable;

  // Credentials exist, but none of them can read this format. Say which formats
  // are readable, so the log answers "why did this PDF fail" without a debugger.
  logWarn("documents.unsupported_source", {
    mimeType,
    providers: adapters.map((adapter) => adapter.provider),
    readable: adapters.flatMap((adapter) => [...adapter.capabilities.accepts]),
  });
  throw new DocumentProcessingProviderError("unsupported_source");
}

/**
 * The adapter that would be tried first, regardless of document type. Used for
 * the pipeline's metadata stamp (which provider/model produced an extraction).
 */
export function primaryDocumentAdapter(): DocumentProcessingAdapter {
  const adapters = availableAdapters();
  if (adapters.length === 0) throw new DocumentProcessingProviderError("provider_unavailable");
  return adapters[0];
}

/**
 * Backwards-compatible entry point. Existing callers asked for "the configured
 * adapter" with no MIME type; they keep working and get the primary provider.
 */
export function configuredDocumentProcessingAdapter(): DocumentProcessingAdapter {
  return primaryDocumentAdapter();
}
