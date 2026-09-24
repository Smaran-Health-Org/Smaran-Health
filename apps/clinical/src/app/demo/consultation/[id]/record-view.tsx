import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { ConsultationPreconsultContext } from "@/app/consultations/[id]/consultation-preconsult-context";
import type { NoteContent } from "@/lib/db/clinical-notes";
import type { PreconsultBriefAtConsultationStart } from "@/lib/preconsult/consultation-start";
import styles from "./demo.module.css";

/**
 * DEMO ONLY — read-only prototype of the consultation record redesign.
 *
 * Two layouts over the same data so the shape can be judged before committing:
 *   variant "a" — full record, single scrolling column
 *   variant "b" — record plus a sticky context rail
 *
 * New in both: the saved dialogue transcript is surfaced as a first-class part
 * of the record instead of a collapsed "reference only" disclosure.
 */

/** Timestamps arrive as Date from the DB layer; accept both so the view stays
    agnostic about whether a server or client caller supplies them. */
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

const NOTE_FIELDS: Array<{ key: keyof NoteContent; label: string }> = [
  { key: "chiefComplaint", label: "Chief complaint" },
  { key: "summary", label: "Consultation summary" },
  { key: "medicationChanges", label: "Medication changes" },
  { key: "investigations", label: "Investigations" },
  { key: "followUpPlan", label: "Follow-up plan" },
  { key: "patientInstructions", label: "Patient instructions" },
];

function initials(name: string): string {
  return name
    .replace(/^(Dr\.?|Doctor)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Clinic-local (Asia/Kolkata) formatting, done on the server so the markup is stable. */
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

function Section({
  eyebrow,
  title,
  hint,
  children,
}: {
  eyebrow: string;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function FactGrid({ facts }: { facts: Array<{ label: string; value: string | null }> }) {
  return (
    <dl className={styles.factGrid}>
      {facts.map((fact) => (
        <div className={styles.fact} key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value && fact.value.trim() ? fact.value : "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every note field is shown, populated or not, so the record reads complete. */
function NoteFields({ content }: { content: NoteContent | null }) {
  return (
    <div className={styles.fields}>
      {NOTE_FIELDS.map((field) => {
        const value = content?.[field.key] ?? "";
        const empty = isBlank(value);
        return (
          <div className={styles.field} key={field.key} data-empty={empty}>
            <span className={styles.fieldLabel}>{field.label}</span>
            <p>{empty ? "Not recorded in this visit." : value}</p>
          </div>
        );
      })}
      {content && !isBlank(content.uncertainItems) ? (
        <div className={styles.uncertain}>
          <span className={styles.fieldLabel}>
            Uncertain items <span className={styles.pill}>Requires verification</span>
          </span>
          <p>{content.uncertainItems}</p>
        </div>
      ) : null}
    </div>
  );
}

function TranscriptSection({
  transcript,
  audio,
}: {
  transcript: RecordTranscript;
  audio: RecordAudio;
}) {
  const text = transcript?.rawText?.trim() ?? "";
  return (
    <Section
      eyebrow="Source of this record"
      title="Dialogue transcript"
      hint={text ? `${text.length.toLocaleString("en-IN")} characters` : undefined}
    >
      <div className={styles.transcriptMeta}>
        {audio?.durationSeconds ? <span className={styles.chip}>Recording · {duration(audio.durationSeconds)}</span> : null}
        {transcript?.modelVersion ? <span className={styles.chip}>Transcribed · {transcript.modelVersion}</span> : null}
        {audio?.transcriptionStatus ? (
          <span className={styles.chip} data-tone={audio.transcriptionStatus === "completed" ? "ok" : "warn"}>
            {audio.transcriptionStatus.replace(/_/g, " ")}
          </span>
        ) : null}
        <span className={styles.chip}>Original audio retained privately</span>
      </div>
      {text ? (
        <p className={styles.transcript}>{text}</p>
      ) : (
        <p className={styles.transcriptEmpty}>
          No recording transcript exists for this visit. It was documented without recording, so the note
          below is the only source.
        </p>
      )}
    </Section>
  );
}

function PreconsultSection({
  patientId,
  context,
}: {
  patientId: string;
  context: PreconsultBriefAtConsultationStart | null;
}) {
  return (
    <Section eyebrow="Known before this visit" title="Pre-consult context">
      {context ? (
        <ConsultationPreconsultContext patientId={patientId} context={context} />
      ) : (
        <p className={styles.empty}>No pre-consult context was captured for this visit.</p>
      )}
    </Section>
  );
}

function HistorySection({ timeline }: { timeline: RecordTimelineEvent[] }) {
  return (
    <Section eyebrow="Approved history only" title="Visit history" hint="Draft and rejected notes excluded">
      {timeline.length === 0 ? (
        <p className={styles.empty}>No approved visits recorded yet.</p>
      ) : (
        <ul className={styles.log}>
          {timeline.map((event) => (
            <li key={event.id}>
              <time>{event.date}</time>
              <div>
                <strong>{event.title}</strong>
                <p>{event.detail || "No summary recorded."}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function MemorySection({ memory }: { memory: RecordMemory }) {
  if (!memory?.summary) return null;
  return (
    <Section eyebrow="Carried forward" title="Follow-up memory" hint={memory.lastVisitAt ? `Last visit ${formatIst(memory.lastVisitAt, false)}` : undefined}>
      <div className={styles.stack}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Standing summary</span>
          <p>{memory.summary}</p>
        </div>
        {!isBlank(memory.medicationChanges) ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Medication changes</span>
            <p>{memory.medicationChanges}</p>
          </div>
        ) : null}
        {!isBlank(memory.followUpPlan) ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Follow-up plan</span>
            <p>{memory.followUpPlan}</p>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

export function ConsultationRecordView({
  variant,
  consultation,
  patient,
  doctorName,
  note,
  transcript,
  audio,
  recordingStatus,
  timeline,
  memory,
  preconsultContext,
}: {
  variant: "a" | "b";
  consultation: RecordConsultation;
  patient: RecordPatient;
  doctorName: string;
  note: RecordNote;
  transcript: RecordTranscript;
  audio: RecordAudio;
  recordingStatus: string | null;
  timeline: RecordTimelineEvent[];
  memory: RecordMemory;
  preconsultContext: PreconsultBriefAtConsultationStart | null;
}) {
  const patientFacts = [
    { label: "Age", value: patient.age != null ? `${patient.age} yrs` : null },
    { label: "Gender", value: patient.gender },
    { label: "Phone", value: patient.phone },
    { label: "MRN", value: patient.medicalRecordNumber },
  ];

  const visitFacts = [
    { label: "Date & time", value: formatIst(consultation.startedAt) },
    { label: "Doctor", value: doctorName },
    { label: "Ended", value: consultation.endedAt ? formatIst(consultation.endedAt) : null },
    { label: "Consent", value: consultation.consentAcquired ? "Recorded" : "Not recorded" },
  ];

  const provenanceFacts = [
    { label: "Recording", value: recordingStatus ? recordingStatus.replace(/_/g, " ") : null },
    { label: "Length", value: duration(audio?.durationSeconds ?? null) },
    { label: "Transcript model", value: transcript?.modelVersion ?? null },
    { label: "Transcribed at", value: transcript?.createdAt ? formatIst(transcript.createdAt) : null },
  ];

  const header = (
    <>
      <Link href={`/patients/${patient.id}`} className={styles.backLink}>
        ← Patient profile
      </Link>

      <div className={styles.demoBanner}>
        <span>
          Demo prototype · read-only · not linked from the app. Same data, two layouts.
        </span>
        <nav className={styles.demoSwitcher} aria-label="Prototype variant">
          <Link href={`?variant=a`} data-active={variant === "a"}>
            A · Full record
          </Link>
          <Link href={`?variant=b`} data-active={variant === "b"}>
            B · Record + context rail
          </Link>
        </nav>
      </div>

      <div className={styles.recordHeader}>
        <div className={styles.recordIdentity}>
          <span className={styles.recordAvatar}>{initials(patient.fullName)}</span>
          <div>
            <p className={styles.eyebrow}>Consultation record</p>
            <h1>{patient.fullName}</h1>
            <p>
              {formatIst(consultation.startedAt)} · {doctorName}
            </p>
            <div className={styles.recordChips}>
              <StatusBadge status={consultation.status} />
              <span className={styles.chip} data-tone={note ? "ok" : "warn"}>
                {note ? `Note · ${note.status.replace(/_/g, " ")}` : "No note"}
              </span>
              {transcript?.rawText ? (
                <span className={styles.chip} data-tone="ok">
                  Transcript available
                </span>
              ) : (
                <span className={styles.chip} data-tone="warn">
                  No transcript
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  if (variant === "b") {
    return (
      <div className={styles.page}>
        {header}
        <div className={styles.rail}>
          <div className={styles.single}>
            <TranscriptSection transcript={transcript} audio={audio} />
            <Section
              eyebrow="Doctor-approved"
              title="Clinical note"
              hint={note?.approvedAt ? `Approved ${formatIst(note.approvedAt)}` : undefined}
            >
              {note ? <NoteFields content={note.content} /> : <p className={styles.empty}>No note was recorded for this visit.</p>}
            </Section>
            <PreconsultSection patientId={patient.id} context={preconsultContext} />
          </div>
          <div className={styles.railSide}>
            <Section eyebrow="Visit" title="This visit">
              <FactGrid facts={visitFacts} />
            </Section>
            <Section eyebrow="Patient" title="Patient">
              <FactGrid facts={patientFacts} />
            </Section>
            <Section eyebrow="Evidence" title="Recording & transcript">
              <FactGrid facts={provenanceFacts} />
            </Section>
            <MemorySection memory={memory} />
            <HistorySection timeline={timeline} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <TranscriptSection transcript={transcript} audio={audio} />
      <Section
        eyebrow="Doctor-approved"
        title="Clinical note"
        hint={note?.approvedAt ? `Approved ${formatIst(note.approvedAt)}` : undefined}
      >
        {note ? <NoteFields content={note.content} /> : <p className={styles.empty}>No note was recorded for this visit.</p>}
      </Section>
      <Section eyebrow="Visit" title="This visit">
        <FactGrid facts={visitFacts} />
      </Section>
      <Section eyebrow="Patient" title="Patient">
        <FactGrid facts={patientFacts} />
      </Section>
      <PreconsultSection patientId={patient.id} context={preconsultContext} />
      <MemorySection memory={memory} />
      <HistorySection timeline={timeline} />
      <Section eyebrow="Evidence" title="Recording & transcript">
        <FactGrid facts={provenanceFacts} />
      </Section>
    </div>
  );
}
