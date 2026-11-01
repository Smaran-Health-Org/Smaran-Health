import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guards the document-provider registry.
 *
 * The failure this prevents is silent and expensive: `DOCUMENT_PROCESSING_PROVIDER`
 * is one environment variable, and switching it must not quietly change what the
 * model is asked for, nor turn a PDF into a provider error. Two properties are
 * pinned here:
 *
 *   1. every adapter declares what it can read, and DeepSeek declares no PDF —
 *      because the live API rejects PDFs (see the adapter's comment);
 *   2. the prompt and response schema exist once, in the shared contract, so a
 *      new provider cannot drift from the others.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const CONTRACT = read("../lib/documents/extraction-contract.ts");
const REGISTRY = read("../lib/documents/document-adapter-registry.ts");
const OPENAI = read("../lib/documents/openai-document-adapter.ts");
const GEMINI = read("../lib/documents/gemini-document-adapter.ts");
const DEEPSEEK = read("../lib/documents/deepseek-document-adapter.ts");
const PIPELINE = read("../lib/documents/pipeline.ts");
const PROCESS = read("../lib/documents/process.ts");

test("the extraction contract is defined once", () => {
  assert.match(CONTRACT, /export const DOCUMENT_SYSTEM_PROMPT/);
  assert.match(CONTRACT, /export const DOCUMENT_RESPONSE_SCHEMA/);

  // A provider that inlines its own prompt is how two providers start asking for
  // different facts without anyone noticing.
  for (const [name, source] of Object.entries({ openai: OPENAI, gemini: GEMINI, deepseek: DEEPSEEK })) {
    assert.match(source, /DOCUMENT_SYSTEM_PROMPT/, `${name} must use the shared prompt`);
    assert.doesNotMatch(
      source,
      /You are a medical-document transcription/,
      `${name} must not inline its own copy of the prompt`
    );
  }
});

test("every adapter declares the formats it can actually read", () => {
  for (const [name, source] of Object.entries({ openai: OPENAI, gemini: GEMINI, deepseek: DEEPSEEK })) {
    assert.match(
      source,
      /_CAPABILITIES:\s*DocumentCapabilities\s*=/,
      `${name} must declare capabilities so the registry can route around it`
    );
  }

  // Verified against the live API: DeepSeek rejects application/pdf with
  // "unsupported file … webp, png, jpeg, and gif". Assert on the accepts set
  // itself, not on surrounding prose that mentions the format.
  const deepseekAccepts = /accepts:\s*new Set<SupportedDocumentMime>\(\[([^\]]*)\]\)/.exec(DEEPSEEK)?.[1] ?? "";
  assert.ok(deepseekAccepts, "DeepSeek must declare an accepts set");
  assert.doesNotMatch(
    deepseekAccepts,
    /application\/pdf/,
    "DeepSeek cannot read PDFs; claiming otherwise turns every PDF into a provider error"
  );

  // PDF is the primary medical-document format, so at least one provider must
  // accept it, or the document path only ever works for photographs of paper.
  for (const [name, source] of Object.entries({ openai: OPENAI, gemini: GEMINI })) {
    assert.match(source, /application\/pdf/, `${name} must accept PDFs`);
  }
});

test("the registry routes by capability, not by which key happens to exist", () => {
  assert.match(
    REGISTRY,
    /capabilities\.accepts\.has\(mimeType\)/,
    "selection must consider the document type"
  );
  assert.match(
    REGISTRY,
    /providers:\s*adapters\.map/,
    "an unsupported format must log which providers were tried and what they can read"
  );
});

test("the pipeline resolves the provider per document, after byte validation", () => {
  // Choosing the adapter before reading the file would trust the MIME type the
  // uploader claimed rather than the bytes.
  assert.match(PIPELINE, /resolveDocumentAdapter/, "pipeline must use the registry resolver");
  assert.match(
    PROCESS,
    /const adapter = resolveAdapter\(actualMime\)/,
    "resolution must happen on the validated MIME type"
  );
});

test("a misconfigured provider name cannot masquerade as a working one", () => {
  assert.match(
    REGISTRY,
    /documents\.provider_unknown/,
    "an unknown DOCUMENT_PROCESSING_PROVIDER must be logged, not silently ignored"
  );
  assert.match(
    REGISTRY,
    /documents\.no_provider_configured/,
    "missing credentials must be reported as provider_unavailable, not unsupported_source"
  );
});

test("DeepSeek uses an image-capable model", () => {
  // `deepseek-chat` is text-only. Using it for documents would produce a confident
  // answer about a page the model never saw.
  assert.match(REGISTRY, /deepseek-flash/, "DeepSeek documents require the vision-capable model");
});
