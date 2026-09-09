import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { getPatient, countPatients } from "@/lib/db/patients";
import { getClinicName } from "@/lib/db/clinics";
import { getPatientTimeline } from "@/lib/db/timeline";
import { getClinicalNoteByConsultation } from "@/lib/db/clinical-notes";
import { getTranscriptByConsultation } from "@/lib/db/transcripts";
import { getFollowUpMemory } from "@/lib/db/follow-up-memory";
import {
  ConsultationWorkflow,
  type NoteContent,
  type WorkflowPatient,
  type WorkflowTimelineEvent,
} from "./consultation-workflow";

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) redirect("/login");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) notFound();

  // Resolve everything else concurrently — the previously-sequential
  // getPatient plus a wasteful `getPatients({ pageSize: 1 })` (only for its
  // `.total`) are now folded in, using a cheap `countPatients` instead.
  const [patient, clinicName, timeline, note, transcript, patientCount, memory] =
    await Promise.all([
      getPatient(consultation.patientId, session.clinicId),
      getClinicName(session.clinicId),
      getPatientTimeline(consultation.patientId, session.clinicId),
      getClinicalNoteByConsultation(id, session.clinicId),
      getTranscriptByConsultation(id, session.clinicId),
      countPatients(session.clinicId),
      getFollowUpMemory(consultation.patientId, session.clinicId),
    ]);
  if (!patient) notFound();

  const workflowPatient: WorkflowPatient = {
    id: patient.id,
    fullName: patient.fullName ?? "",
    age: patient.age ?? null,
    gender: patient.gender ?? null,
    phone: patient.phone ?? null,
    medicalRecordNumber: patient.medicalRecordNumber ?? null,
  };

  const workflowTimeline: WorkflowTimelineEvent[] = timeline.map((event) => ({
    id: event.id,
    date: String(event.createdAt),
    title: event.eventType === "follow_up" ? "Follow-up note" : event.eventType,
    detail: event.summary ?? "",
  }));

  const initialNote: NoteContent | null = note?.content
    ? (note.content as NoteContent)
    : null;

  return (
    <ConsultationWorkflow
      consultationId={id}
      patient={workflowPatient}
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={patientCount}
      timeline={workflowTimeline}
      initialNote={initialNote}
      initialStatus={consultation.status}
      initialTranscript={transcript?.rawText ?? null}
      memory={memory}
    />
  );
}
