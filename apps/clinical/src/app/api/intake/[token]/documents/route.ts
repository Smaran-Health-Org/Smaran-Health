import { NextRequest, NextResponse } from "next/server";
import {
  DocumentAccessError,
  getPatientDocumentUploadContext,
  getPatientRegisteredDocument,
  listPatientDocuments,
  registerPatientDocument,
} from "@/lib/db/documents";
import { DocumentFileError } from "@/lib/documents/file";
import { DocumentIngestionError, ingestDocument, parseDocumentUpload } from "@/lib/documents/ingest";
import { verifiedIntakeCredentials } from "@/lib/intake/verified-session";
import { badRequest, internalError, payloadTooLarge, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const credentials = await verifiedIntakeCredentials(token);
    if (!credentials) return unauthorized("OTP verification is required");
    const context = await getPatientDocumentUploadContext(
      credentials.tokenHash,
      credentials.verifiedSessionHash
    );
    if (!context) return unauthorized("Submit consented intake before uploading documents");
    const documents = await listPatientDocuments(
      credentials.tokenHash,
      credentials.verifiedSessionHash
    );
    return noStoreJson({ documents });
  } catch {
    return internalError("Could not load uploaded documents");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const credentials = await verifiedIntakeCredentials(token);
    if (!credentials) return unauthorized("OTP verification is required");
    const context = await getPatientDocumentUploadContext(
      credentials.tokenHash,
      credentials.verifiedSessionHash
    );
    if (!context) return unauthorized("Submit consented intake before uploading documents");
    const upload = await parseDocumentUpload(request);
    const document = await ingestDocument({
      context,
      upload,
      register: (input) => registerPatientDocument(
        credentials.tokenHash,
        credentials.verifiedSessionHash,
        input
      ),
      lookupRegistered: (input) => getPatientRegisteredDocument(
        credentials.tokenHash,
        credentials.verifiedSessionHash,
        input
      ),
    });
    return noStoreJson({ document }, { status: 201 });
  } catch (error) {
    if ((error instanceof DocumentFileError && error.kind === "size")
      || (error instanceof DocumentIngestionError && error.kind === "size")) {
      return payloadTooLarge("Choose a medical document up to 4 MB");
    }
    if (error instanceof DocumentFileError || (error instanceof DocumentIngestionError && error.kind === "request")) {
      return badRequest("Choose a PDF or supported photo up to 4 MB and check its details");
    }
    if (error instanceof DocumentAccessError && error.kind === "forbidden") {
      return unauthorized("This intake session is invalid or expired");
    }
    return internalError("Could not store the medical document");
  }
}
