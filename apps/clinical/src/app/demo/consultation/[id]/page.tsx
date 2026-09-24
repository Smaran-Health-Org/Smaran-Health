import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { getPatient, getPatients } from "@/lib/db/patients";
import { getClinicDoctors, getClinicName } from "@/lib/db/clinics";
import { getPatientTimeline } from "@/lib/db/timeline";
import { getClinicalNoteByConsultation, type NoteContent } from "@/lib/db/clinical-notes";
import { getTranscriptByConsultation } from "@/lib/db/transcripts";
import { getFollowUpMemory } from "@/lib/db/follow-up-memory";
import { getPreconsultBriefAtConsultationStart } from "@/lib/preconsult/brief";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ConsultationRecordView, type RecordAudio, type RecordNote } from "./record-view";
import styles from "@/components/clinical.module.css";

/**
 * DEMO ONLY — prototype of the consultation record redesign.
 *
 * Deliberately NOT linked from the app navigation and NOT replacing the real
 * page: this exists so the layout can be judged on real data before anything
 * is committed to. Read-only — it creates no clinical state, and it reuses the
 * same doctor-only guard and clinic scoping as `/consultations/[id]`.
 *
 * Open: /demo/consultation/<consultationId>?variant=a|b
 */

const istDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
});

/** Source recording metadata. Read under the caller's JWT so clinic RLS applies. */
async function getAudioMeta(consultationId: string, clinicId: string): Promise<RecordAudio> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("audio_files")
    .select("duration_seconds, format, recording_status, transcription_status")
    .eq("consultation_id", consultationId)
    .eq("clinic_id", clinicId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    durationSeconds: (data.duration_seconds as number | null) ?? null,
    format: (data.format as string | null) ?? null,
    recordingStatus: String(data.recording_status ?? "unknown"),
    transcriptionStatus: String(data.transcription_status ?? "unknown"),
  };
}

export default async function DemoConsultationRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const { id } = await params;
  const { variant } = await searchParams;

  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.role !== "doctor") redirect("/desk");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) notFound();

  const patient = await getPatient(consultation.patientId, session.clinicId);
  if (!patient) notFound();

  // Optional sources are isolated so one unavailable dependency degrades the
  // prototype instead of failing the whole page.
  const [clinicName, timeline, note, transcript, patientList, memory, preconsultContext, audio, doctors] =
    await Promise.all([
      getClinicName(session.clinicId),
      getPatientTimeline(patient.id, session.clinicId).catch(() => []),
      getClinicalNoteByConsultation(id, session.clinicId).catch(() => null),
      getTranscriptByConsultation(id, session.clinicId).catch(() => null),
      getPatients(session.clinicId, { pageSize: 1 }),
      getFollowUpMemory(patient.id, session.clinicId).catch(() => null),
      getPreconsultBriefAtConsultationStart({
        consultationId: consultation.id,
        clinicId: session.clinicId,
        patientId: consultation.patientId,
      }).catch(() => null),
      getAudioMeta(id, session.clinicId).catch(() => null),
      getClinicDoctors(session.clinicId).catch(() => []),
    ]);

  const treatingDoctor =
    doctors.find((doctor) => doctor.id === consultation.doctorId)?.fullName ?? session.fullName;

  const recordNote: RecordNote = note
    ? {
        status: note.status,
        approvedAt: note.approvedAt ?? null,
        content: (note.content as NoteContent | null) ?? null,
      }
    : null;

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
          variant={variant === "b" ? "b" : "a"}
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
          doctorName={treatingDoctor}
          note={recordNote}
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
          recordingStatus={audio?.recordingStatus ?? null}
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
