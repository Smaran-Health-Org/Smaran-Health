import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { AppShell } from "@/components/app-shell";
import styles from "@/components/clinical.module.css";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { getPatient, getPatients } from "@/lib/db/patients";
import { getClinicDoctors, getClinicName } from "@/lib/db/clinics";
import { getPatientTimeline } from "@/lib/db/timeline";
import { getClinicalNoteByConsultation } from "@/lib/db/clinical-notes";
import { getTranscriptByConsultation } from "@/lib/db/transcripts";
import { getConsultationAudioMeta } from "@/lib/db/audio-files";
import { getFollowUpMemory } from "@/lib/db/follow-up-memory";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  getPreconsultBriefAtConsultationStart,
  recordPreconsultBriefViewWithClient,
} from "@/lib/preconsult/brief";
import { ConsultationRecordView } from "./record-view";
import {
  ConsultationWorkflow,
  type NoteContent,
  type WorkflowPatient,
  type WorkflowTimelineEvent,
} from "./consultation-workflow";

const istDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
});

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

  const [clinicName, timeline, note, transcript, patientList, memory, preconsultContext] = await Promise.all([
    getClinicName(session.clinicId),
    getPatientTimeline(patient.id, session.clinicId),
    getClinicalNoteByConsultation(id, session.clinicId),
    getTranscriptByConsultation(id, session.clinicId),
    getPatients(session.clinicId, { pageSize: 1 }),
    getFollowUpMemory(patient.id, session.clinicId),
    getPreconsultBriefAtConsultationStart({
      consultationId: consultation.id,
      clinicId: session.clinicId,
      patientId: consultation.patientId,
    }),
  ]);

  if (preconsultContext.status === "brief_available") {
    // Viewing provenance is useful but must never delay or block a consultation.
    // Capture cookie-backed auth during rendering: Next.js Server Components
    // cannot create request clients from an after() callback.
    const briefViewClient = await createServerClient();
    after(() => recordPreconsultBriefViewWithClient(
      briefViewClient,
      consultation.id,
      preconsultContext.briefVersionId
    ).catch(() => undefined));
  }

  // A completed visit opens as a read-only record. The live encounter workflow is
  // deliberately left in charge of open visits so recording, review and approval
  // are untouched — only the terminal state is replaced.
  if (consultation.status === "approved") {
    const [audio, doctors] = await Promise.all([
      getConsultationAudioMeta(id, session.clinicId).catch(() => null),
      getClinicDoctors(session.clinicId).catch(() => []),
    ]);

    return (
      <AppShell
        doctorName={session.fullName}
        clinicName={clinicName}
        patientCount={patientList.total}
        role={session.role}
        workspace="clinical"
      >
        <div className={styles.pageContent}>
          <ConsultationRecordView
            consultation={{
              id: consultation.id,
              status: consultation.status,
              startedAt: consultation.startedAt,
              endedAt: consultation.endedAt ?? null,
              consentAcquired: consultation.consentAcquired,
              consentTimestamp: consultation.consentTimestamp ?? null,
            }}
            patient={{
              id: patient.id,
              fullName: patient.fullName ?? "Patient",
              age: patient.age ?? null,
              gender: patient.gender ?? null,
              phone: patient.phone ?? null,
              medicalRecordNumber: patient.medicalRecordNumber ?? null,
            }}
            doctorName={
              doctors.find((doctor) => doctor.id === consultation.doctorId)?.fullName ??
              session.fullName
            }
            note={
              note
                ? {
                    status: note.status,
                    approvedAt: note.approvedAt ?? null,
                    content: (note.content as NoteContent | null) ?? null,
                  }
                : null
            }
            transcript={
              transcript
                ? {
                    rawText: transcript.rawText ?? "",
                    modelVersion: transcript.modelVersion ?? null,
                    createdAt: transcript.createdAt ?? null,
                  }
                : null
            }
            audio={audio}
            timeline={timeline.map((event) => ({
              id: event.id,
              date: istDate.format(new Date(event.createdAt)),
              title: event.eventType === "follow_up" ? "Follow-up note" : event.eventType,
              detail: event.summary ?? "",
            }))}
            memory={memory}
            preconsultContext={preconsultContext}
          />
        </div>
      </AppShell>
    );
  }

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
      canReviewNote={consultation.doctorId === session.profileId}
      patient={workflowPatient}
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={patientList.total}
      timeline={workflowTimeline}
      initialNote={initialNote}
      initialNoteRevision={note?.revision ?? null}
      initialStatus={consultation.status}
      initialTranscript={transcript?.rawText ?? null}
      memory={memory}
      preconsultContext={preconsultContext}
    />
  );
}
