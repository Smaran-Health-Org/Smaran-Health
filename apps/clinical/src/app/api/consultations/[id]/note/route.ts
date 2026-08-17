import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation, updateConsultation } from "@/lib/db/consultations";
import { getPatient } from "@/lib/db/patients";
import {
  getClinicalNoteByConsultation,
  upsertClinicalNote,
} from "@/lib/db/clinical-notes";
import { createTimelineEvent } from "@/lib/db/timeline";
import { createAuditLog } from "@/lib/db/audit";
import { saveClinicalNoteSchema } from "@/lib/validation";
import { badRequest, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const note = await getClinicalNoteByConsultation(id, session.clinicId);
  return NextResponse.json({ note });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const body = await request.json();
  const parsed = saveClinicalNoteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid clinical note", parsed.error.flatten());

  const { status, content, summary } = parsed.data;

  const note = await upsertClinicalNote(
    {
      consultationId: id,
      doctorId: session.profileId,
      content,
      status,
    },
    session.clinicId
  );

  // Approval is the only path that writes to clinical memory.
  if (status === "approved") {
    const patient = await getPatient(consultation.patientId, session.clinicId);
    if (patient) {
      await createTimelineEvent(
        {
          patientId: patient.id,
          consultationId: id,
          clinicalNoteId: note.id,
          eventType: "follow_up",
          summary: summary || content.summary,
        },
        session.clinicId
      );
    }
    await updateConsultation(id, { status: "approved" }, session.clinicId);
  } else if (status === "rejected") {
    await updateConsultation(id, { status: "rejected" }, session.clinicId);
  } else {
    // ai_draft / edited → keep the note editable and surface it for review.
    await updateConsultation(id, { status: "draft_ready" }, session.clinicId);
  }

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "clinical_note.updated",
    "clinical_note",
    note.id,
    { status }
  );

  return NextResponse.json({ note }, { status: 201 });
}
