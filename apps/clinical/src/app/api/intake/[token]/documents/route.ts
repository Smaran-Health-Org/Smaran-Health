import { after, NextRequest, NextResponse } from "next/server";
import {
  DocumentAccessError,
  acceptPatientDocumentStorageConsent,
  getPatientDocumentUploadContext,
  getPatientRegisteredDocument,
  listPatientDocuments,
  registerPatientDocument,
} from "@/lib/db/documents";
import { DocumentFileError } from "@/lib/documents/file";
import { DocumentIngestionError, ingestDocument, parseDocumentUpload } from "@/lib/documents/ingest";
import { verifiedIntakeCredentials } from "@/lib/intake/verified-session";
import { badRequest, internalError, payloadTooLarge, unauthorized } from "@/lib/api/error-handler";
import { wakeDocumentPipeline } from "@/lib/documents/pipeline";

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
    if (!credentials) return unauthorized("This intake session is invalid or expired");
    const context = await getPatientDocumentUploadContext(
      credentials.tokenHash,
      credentials.verifiedSessionHash
    );
    // Before the patient chooses to upload there cannot yet be any documents.
    // Keep the verified draft form quiet instead of presenting a false error.
    if (!context) return noStoreJson({ documents: [] });
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
    if (!credentials) return unauthorized("This intake session is invalid or expired");
    const upload = await parseDocumentUpload(request);
    if (!upload.documentStorageConsentAccepted) {
      return badRequest("Please agree to secure document storage before uploading.");
    }
    await acceptPatientDocumentStorageConsent({
      ...credentials,
      consentVersion: "preconsult-intake-consent/v1.0",
    });
    const context = await getPatientDocumentUploadContext(credentials.tokenHash, credentials.verifiedSessionHash);
    if (!context) return unauthorized("This intake session cannot upload documents");
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
    // Registration committed a durable queue row in the same database event.
    // This wakeup lowers latency but may safely be lost on request termination.
    after(() => wakeDocumentPipeline());
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
