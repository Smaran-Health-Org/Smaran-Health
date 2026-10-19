import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { forbidden, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

/**
 * DEMO-ONLY live transcript configuration.
 *
 * The realtime WebSocket authenticates with `api-subscription-key.<key>` in a
 * browser subprotocol, so the vendor key has to reach the client. That is only
 * acceptable for the hackathon demo build: rotate SARVAM_API_KEY afterwards.
 *
 * Security properties kept here:
 *   • session required, doctor only, clinic scoped (getConsultation);
 *   • recording consent must already be recorded;
 *   • disabled unless LIVE_TRANSCRIPT_DEMO=1 and a key exists.
 *
 * Production must replace this with a relay that holds the key server-side.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can use live preview");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const enabled = process.env.LIVE_TRANSCRIPT_DEMO === "1";
  const key = (process.env.SARVAM_API_KEY || "").trim();

  if (!enabled || !key) {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!consultation.consentAcquired) {
    return forbidden("Recording consent is required before live preview");
  }

  return NextResponse.json(
    {
      enabled: true,
      demoOnly: true,
      url: "wss://api.sarvam.ai/speech-to-text-realtime/ws",
      key,
      model: process.env.LIVE_TRANSCRIPT_MODEL || "saaras:v3-realtime",
      language: process.env.LIVE_TRANSCRIPT_LANGUAGE || "auto",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
