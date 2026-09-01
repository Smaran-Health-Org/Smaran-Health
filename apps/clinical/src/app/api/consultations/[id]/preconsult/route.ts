import { after, NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { getCurrentPreconsultBrief, drainPreconsultBriefGeneration, recordPreconsultBriefView } from "@/lib/preconsult/brief";
import { forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can view pre-consult briefs");
  const { id } = await params;
  try {
    const consultation = await getConsultation(id, session.clinicId);
    if (!consultation) return notFound("Consultation not found");
    const brief = await getCurrentPreconsultBrief(id);
    if (brief) await recordPreconsultBriefView(id, brief.id);
    // The work was committed with the source event. This is only an
    // opportunistic drain; its termination cannot affect care or source data.
    after(() => drainPreconsultBriefGeneration().catch(() => undefined));
    return NextResponse.json({ brief }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
  } catch {
    return internalError("Could not load the pre-consult brief");
  }
}
