import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import type { NoteContent } from "@/lib/db/clinical-notes";
import type { PreconsultBriefAtConsultationStart } from "@/lib/preconsult/consultation-start";
import { ConsultationPreconsultContext } from "./consultation-preconsult-context";
import { BulletList, ChangeList, PresentingComplaint, stripListMarkers } from "./structured-text";
import { TranscriptPanel } from "./transcript-panel";
import styles from "./record.module.css";

/**
 * Read-only record of a COMPLETED (approved) consultation.
 *
 * Ordered by clinical decision value rather than by data source: what the
 * patient presented with, what was concluded, what changed, what still needs
 * checking, then the raw evidence, background and history.
 *
 * The live encounter workflow is untouched — in-progress consultations still
 * render `ConsultationWorkflow`. Only the terminal state is replaced here, so a
 * doctor never loses the ability to record, review or approve an open visit.
 *
 * Read-only by construction: this component writes nothing and creates no
 * clinical state.
 */

type Instant = Date | string;

export type RecordConsultation = {
  id: string;
  status: string;
  startedAt: Instant;
  endedAt: Instant | null;
  consentAcquired: boolean | null;
  consentTimestamp: Instant | null;
};

export type RecordPatient = {
  id: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  medicalRecordNumber: string | null;
};

export type RecordTranscript = {
  rawText: string;
  modelVersion: string | null;
  createdAt: Instant | null;
} | null;

export type RecordAudio = {
  durationSeconds: number | null;
  format: string | null;
  recordingStatus: string;
  transcriptionStatus: string;
} | null;

export type RecordNote = {
  status: string;
  approvedAt: Instant | null;
  content: NoteContent | null;
} | null;

export type RecordTimelineEvent = { id: string; date: string; title: string; detail: string };

export type RecordMemory = {
  summary: string | null;
  lastVisitAt: Instant | null;
  medicationChanges: string | null;
  investigations: string | null;
  followUpPlan: string | null;
  patientInstructions: string | null;
} | null;

function initials(name: string): string {
  return name
    .replace(/^(Dr\.?|Doctor)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Clinic-local (Asia/Kolkata) formatting, done on the server so markup is stable. */
function formatIst(value: Instant | null, withTime = true): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(value instanceof Date ? value : new Date(value));
}

function duration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function isBlank(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "None." || trimmed === "None stated." || trimmed === "N/A";
}

export function ConsultationRecordView({
  consultation,
  patient,
  doctorName,
  note,
  transcript,
  audio,
  timeline,
  memory,
  preconsultContext,
}: {
  consultation: RecordConsultation;
  patient: RecordPatient;
  doctorName: string;
  note: RecordNote;
  transcript: RecordTranscript;
  audio: RecordAudio;
  timeline: RecordTimelineEvent[];
  memory: RecordMemory;
  preconsultContext: PreconsultBriefAtConsultationStart | null;
}) {
  const content = note?.content ?? null;
  const summary = content?.summary ?? "";

  // Carry-forward memory is the latest approved note, so for the most recent
  // visit it is literally this page's summary. Showing it again would just make
  // the doctor read the same paragraph twice.
  const normalize = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const standing = memory?.summary ?? "";
  const hasStanding = Boolean(standing) && normalize(standing) !== normalize(summary);

  return (
    <div className={styles.page}>
      <Link href={`/patients/${patient.id}`} className={styles.backLink}>
        ← Patient profile
      </Link>

      <div className={styles.recordHeader}>
        <div className={styles.recordIdentity}>
          <span className={styles.recordAvatar}>{initials(patient.fullName)}</span>
          <div>
            <p className={styles.headlineMeta}>Consultation record</p>
            <h1>{patient.fullName}</h1>
            <p>
              {formatIst(consultation.startedAt)} · {doctorName}
            </p>
            <div className={styles.recordChips}>
              <StatusBadge status={consultation.status} />
              <span className={styles.chip} data-tone={note ? "ok" : "warn"}>
                {note ? `Note · ${note.status.replace(/_/g, " ")}` : "No note"}
              </span>
              <span className={styles.chip} data-tone={transcript?.rawText ? "ok" : "warn"}>
                {transcript?.rawText ? "Transcript available" : "No transcript"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.railC}>
        <div className={styles.wrap}>
          <section className={styles.block} id="complaint">
            <div className={styles.blockHead}>
              <h2>Presenting complaint</h2>
              <span className={styles.headlineMeta}>Patient&apos;s stated reason</span>
            </div>
            <PresentingComplaint text={content?.chiefComplaint} />
          </section>

          <section className={styles.block} id="summary">
            <div className={styles.blockHead}>
              <h2>Summary</h2>
              <span className={styles.headlineMeta}>
                {note
                  ? `Approved note · ${note.approvedAt ? formatIst(note.approvedAt) : note.status}`
                  : "No approved note"}
              </span>
            </div>
            {isBlank(summary) ? (
              <p className={styles.muted}>No summary was recorded for this visit.</p>
            ) : (
              <p className={styles.headlineText}>{summary}</p>
            )}
          </section>

          <section className={styles.block} id="changes">
            <div className={styles.blockHead}>
              <h2>What changed this visit</h2>
            </div>
            <div className={styles.delta}>
              <div className={styles.changeGroup}>
                <span className={styles.changeLabel}>Medication</span>
                <ChangeList
                  text={content?.medicationChanges}
                  emptyLabel="No medication changes were recorded."
                />
              </div>
              <div className={styles.changeGroup}>
                <span className={styles.changeLabel}>Investigations</span>
                <BulletList
                  text={content?.investigations}
                  emptyLabel="No investigations were requested."
                />
              </div>
              <div className={styles.changeGroup}>
                <span className={styles.changeLabel}>Follow-up plan</span>
                <BulletList
                  text={content?.followUpPlan}
                  emptyLabel="No follow-up plan was recorded."
                />
              </div>
            </div>
          </section>

          {content && !isBlank(content.uncertainItems) ? (
            <section className={styles.block} id="verify">
              <div className={styles.blockHead}>
                <h2>Needs verification</h2>
              </div>
              <div className={styles.uncertain}>
                <p>{stripListMarkers(content.uncertainItems)}</p>
              </div>
            </section>
          ) : null}

          <TranscriptPanel
            text={transcript?.rawText ?? ""}
            durationLabel={audio?.durationSeconds ? duration(audio.durationSeconds) : null}
            modelVersion={transcript?.modelVersion ?? null}
            status={audio?.transcriptionStatus ?? null}
          />

          <section className={styles.block} id="background">
            <div className={styles.blockHead}>
              <h2>Background</h2>
            </div>
            <div className={styles.fields}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Patient instructions</span>
                <BulletList
                  text={content?.patientInstructions}
                  emptyLabel="No patient instructions were recorded."
                />
              </div>
              {hasStanding && memory?.summary ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Previous approved summary</span>
                  <p>{memory.summary}</p>
                </div>
              ) : null}
              {preconsultContext ? (
                <div className={styles.disclosure}>
                  <details>
                    <summary>Known before this visit (pre-consult context)</summary>
                    <ConsultationPreconsultContext
                      patientId={patient.id}
                      context={preconsultContext}
                    />
                  </details>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.block} id="history">
            <div className={styles.blockHead}>
              <h2>Visit history</h2>
              <span className={styles.headlineMeta}>Approved only</span>
            </div>
            {timeline.length === 0 ? (
              <p className={styles.muted}>No approved visits recorded yet.</p>
            ) : (
              timeline.map((event) => (
                <div className={styles.historyRow} key={event.id}>
                  <time>{event.date}</time>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail || "No summary recorded."}</p>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>

        <aside className={styles.railSideC}>
          <section className={styles.sideCard}>
            <h2>This visit</h2>
            <dl className={styles.kv}>
              <div>
                <dt>Date</dt>
                <dd>{formatIst(consultation.startedAt)}</dd>
              </div>
              <div>
                <dt>Doctor</dt>
                <dd>{doctorName}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{duration(audio?.durationSeconds ?? null)}</dd>
              </div>
              <div>
                <dt>Consent</dt>
                <dd>{consultation.consentAcquired ? "Recorded" : "Not recorded"}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.sideCard}>
            <h2>Patient</h2>
            <dl className={styles.kv}>
              <div>
                <dt>Age</dt>
                <dd>{patient.age != null ? `${patient.age} yrs` : "—"}</dd>
              </div>
              <div>
                <dt>Gender</dt>
                <dd>{patient.gender ?? "—"}</dd>
              </div>
              <div>
                <dt>MRN</dt>
                <dd>{patient.medicalRecordNumber ?? "—"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{patient.phone ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <nav className={styles.sideCard} aria-label="On this page">
            <h2>On this page</h2>
            <div className={styles.jump}>
              <a href="#complaint">Presenting complaint</a>
              <a href="#summary">Summary</a>
              <a href="#changes">What changed</a>
              <a href="#transcript">Dialogue transcript</a>
              <a href="#background">Background</a>
              <a href="#history">Visit history</a>
            </div>
          </nav>

          <p className={styles.provenance}>
            Transcription {transcript?.modelVersion ?? "unavailable"}
            {transcript?.createdAt ? ` · ${formatIst(transcript.createdAt)}` : ""}. Original audio
            retained in private clinic storage.
          </p>
        </aside>
      </div>
    </div>
  );
}
