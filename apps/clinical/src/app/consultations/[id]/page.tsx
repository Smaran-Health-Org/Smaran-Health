import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { getPatient, getPatients } from "@/lib/db/patients";
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
  if (session.role !== "doctor") redirect("/desk");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) notFound();

  const patient = await getPatient(consultation.patientId, session.clinicId);
  if (!patient) notFound();

  const [clinicName, timeline, note, transcript, patientList, memory] = await Promise.all([
    getClinicName(session.clinicId),
    getPatientTimeline(patient.id, session.clinicId),
    getClinicalNoteByConsultation(id, session.clinicId),
    getTranscriptByConsultation(id, session.clinicId),
    getPatients(session.clinicId, { pageSize: 1 }),
    getFollowUpMemory(patient.id, session.clinicId),
  ]);

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
      patientCount={patientList.total}
      timeline={workflowTimeline}
      initialNote={initialNote}
      initialStatus={consultation.status}
      initialTranscript={transcript?.rawText ?? null}
      memory={memory}
    />
  );
}
