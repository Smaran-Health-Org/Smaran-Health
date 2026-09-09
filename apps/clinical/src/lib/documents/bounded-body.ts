import { MAX_DOCUMENT_BYTES } from "./file";

// Leave bounded room for multipart boundaries and the small metadata fields.
export const MAX_DOCUMENT_UPLOAD_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 128 * 1024;

export class DocumentUploadBodyError extends Error {
  constructor() {
    super("Medical document request body is too large");
    this.name = "DocumentUploadBodyError";
  }
}

/** Reads at most the configured number of bytes, including for chunked requests. */
export async function readBoundedDocumentBody(
  request: Request,
  maxBytes = MAX_DOCUMENT_UPLOAD_REQUEST_BYTES
): Promise<Uint8Array> {
  const contentLengthHeader = request.headers.get("content-length")?.trim();
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!/^\d+$/.test(contentLengthHeader) || !Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
      throw new DocumentUploadBodyError();
    }
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new DocumentUploadBodyError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
