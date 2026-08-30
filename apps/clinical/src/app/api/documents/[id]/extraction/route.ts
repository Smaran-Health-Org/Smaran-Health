import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { DocumentAccessError, getDoctorLatestDocumentExtraction } from "@/lib/db/documents";
import { forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can view AI-derived document extraction");
  const { id } = await params;

  try {
    const extraction = await getDoctorLatestDocumentExtraction(id);
    if (!extraction) return notFound("No document extraction is available");
    return NextResponse.json(
      { extraction },
      { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } }
    );
  } catch (error) {
    if (error instanceof DocumentAccessError && error.kind === "not_found") {
      return notFound("No document extraction is available");
    }
    return internalError("Could not load document extraction");
  }
}
