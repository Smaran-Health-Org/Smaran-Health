import { createHash } from "node:crypto";

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_BUCKET = "medical-documents";

export type SupportedDocumentMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif";

const EXTENSIONS: Record<SupportedDocumentMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function detectDocumentMime(bytes: Uint8Array): SupportedDocumentMime | null {
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && ascii(bytes, 1, 3) === "PNG"
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

export function documentContentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safeOriginalFilename(value: string, mime: SupportedDocumentMime): string {
  const fallback = `document.${EXTENSIONS[mime]}`;
  const cleaned = value
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 240);
}

export function documentStoragePath(input: {
  clinicId: string;
  patientId: string;
  documentId: string;
  mime: SupportedDocumentMime;
}): string {
  return `${input.clinicId}/${input.patientId}/${input.documentId}/original.${EXTENSIONS[input.mime]}`;
}

export function validateDocumentBytes(bytes: Uint8Array): SupportedDocumentMime {
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentFileError("size");
  }
  const mime = detectDocumentMime(bytes);
  if (!mime) throw new DocumentFileError("type");
  return mime;
}

export class DocumentFileError extends Error {
  constructor(public readonly kind: "size" | "type") {
    super("Medical document file is invalid");
    this.name = "DocumentFileError";
  }
}
