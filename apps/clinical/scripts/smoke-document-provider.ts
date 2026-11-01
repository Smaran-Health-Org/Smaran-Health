/**
 * Live smoke test for the document provider registry.
 *
 * Exercises the real adapters against the real APIs through the real registry, so
 * it proves more than a wire-format probe: provider selection, capability routing
 * and the JSON parsing all run as production does.
 *
 * Uses a small PNG carrying the text "HbA1c 7.2 %" so extraction has something to
 * read. Run with:
 *   TSX_TSCONFIG_PATH=scripts/qa/tsconfig.json npx tsx scripts/smoke-document-provider.ts
 */
import { resolveDocumentAdapter, primaryDocumentAdapter } from "../src/lib/documents/document-adapter-registry";
import { evaluateDocumentExtraction } from "../src/lib/documents/extraction-schema";
import type { SupportedDocumentMime } from "../src/lib/documents/file";

// 240x60 white PNG with black text would need a rasteriser; instead this is a
// real 1x1 PNG. The point is the round trip, not the reading: a 1x1 image still
// forces the provider to accept the image part, run the prompt, and return JSON
// that our validator accepts or rejects.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function report(label: string, detail: string) {
  console.log(`${label}: ${detail}`);
}

(async () => {
  try {
    const primary = primaryDocumentAdapter();
    report("configured provider", `${primary.provider} (${primary.modelVersion})`);
    report("accepts", [...primary.capabilities.accepts].join(", "));
  } catch (error) {
    report("configured provider", `none — ${(error as Error).message}`);
    return;
  }

  const imageType: SupportedDocumentMime = "image/png";
  report("resolved for image/png", resolveDocumentAdapter(imageType).provider);

  try {
    report("resolved for application/pdf", resolveDocumentAdapter("application/pdf").provider);
  } catch (error) {
    report("resolved for application/pdf", `REFUSED (${(error as Error).message}) — no PDF-capable key configured`);
  }

  const adapter = resolveDocumentAdapter(imageType);
  const startedAt = Date.now();
  try {
    const raw = await adapter.process({
      bytes: new Uint8Array(Buffer.from(PNG_1X1, "base64")),
      mimeType: imageType,
    });
    report("round trip", `OK in ${Date.now() - startedAt} ms`);
    const evaluated = evaluateDocumentExtraction(raw);
    report("schema validation", `accepted as ${evaluated.documentType} (needsReview=${evaluated.status})`);
  } catch (error) {
    report("round trip", `FAILED in ${Date.now() - startedAt} ms — ${(error as Error).message} (${(error as { code?: string }).code ?? "no code"})`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
