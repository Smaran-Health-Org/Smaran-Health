import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extractClinicalDraft } from "@/lib/ai/extract-clinical-note";
import { getConsultation } from "@/lib/db/consultations";
import { getClinicalNoteByConsultation, createClinicalDraft, ClinicalNoteWriteError } from "@/lib/db/clinical-notes";
import { getTranscriptByConsultation } from "@/lib/db/transcripts";
import { extractAndPersistDraft } from "./extract-and-persist-draft";
import { logEvent, logWarn, logError } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClinicalNote } from "@/types";
import type { NoteContent } from "@/lib/db/clinical-notes";
import { DRAFT_SWEEP_AFTER_SECONDS, DRAFT_SWEEP_LOOKBACK_HOURS } from "./draft-policy";

/**
 * Turns a stored transcript into a reviewable AI draft.
 *
 * This used to live only inside `POST /api/consultations/[id]/generate`, which
 * meant the draft existed only if the doctor's browser sat on the progress screen
 * and called it. If they walked away, the transcript arrived later and nothing
 * ever turned it into a draft — the consultation stalled with a transcript and no
 * note. The same logic now also runs from a background sweep, so the doctor comes
 * back to a finished draft instead of an empty visit.
 *
 * Product boundary (AGENTS.md): output is always `ai_draft`. Nothing here
 * approves a note, writes clinical memory, or promotes AI text to confirmed
 * state — a doctor action is still the only path to that.
 */

/** Consultations that are finished — never regenerate over a settled record. */
const SETTLED_STATUSES = ["approved", "rejected"];

/**
 * A skip is routine on the doctor-initiated path (usually "note_already_exists"),
 * but on the background path it almost always means the sweep is broken. Logging
 * it is what stops a total no-op from looking like a healthy 200 response.
 */
function skipped(
  source: "doctor" | "background",
  reason: string,
  consultationId: string
): GenerateDraftResult {
  if (source === "background") logWarn("draft.skipped", { consultationId, reason, source });
  return { kind: "skipped", reason };
}

export type GenerateDraftResult =
  | { kind: "created"; noteId: string; note: ClinicalNote; draft: NoteContent }
  | { kind: "fallback"; noteId: string; note: ClinicalNote; draft: NoteContent; reason: string }
  | { kind: "skipped"; reason: string; note?: ClinicalNote };

/**
 * Generates and stores a draft for one consultation.
 *
 * Idempotent by construction: if ANY note already exists — including one the
 * doctor edited by hand — this refuses to touch it. That guard is what makes it
 * safe to call from a background sweep that may run long after the doctor left,
 * and it is what stops a late sweep from clobbering manual work.
 */
export async function generateDraftForConsultation(input: {
  consultationId: string;
  clinicId: string;
  actorId: string | null;
  source: "doctor" | "background";
  /**
   * Service-role connection for the background sweep. The cron worker runs with
   * no user session, so the request-scoped client would be anonymous and RLS
   * would hide every row — the sweep would silently match nothing. Every query
   * below still filters on `clinicId` explicitly, so scoping does not rest on RLS.
   */
  client?: SupabaseClient;
}): Promise<GenerateDraftResult> {
  const { consultationId, clinicId, actorId, source } = input;
  const db = input.client;

  const consultation = await getConsultation(consultationId, clinicId, db);
  if (!consultation) return skipped(source, "consultation_not_found", consultationId);
  if (source === "doctor" && actorId !== consultation.doctorId) {
    throw new ClinicalNoteWriteError("42501", "Only the consultation doctor can generate a draft");
  }
  if (SETTLED_STATUSES.includes(consultation.status)) {
    return skipped(source, "consultation_settled", consultationId);
  }

  // The clobber guard. A note of any status means a human is already in the loop.
  const existingNote = await getClinicalNoteByConsultation(consultationId, clinicId, db);
  if (existingNote) return { ...skipped(source, "note_already_exists", consultationId), note: existingNote };

  const transcript = await getTranscriptByConsultation(consultationId, clinicId, db);
  const rawText = transcript?.rawText?.trim();
  if (!rawText) return skipped(source, "no_transcript", consultationId);

  // A draft is attributed to the consultation's own doctor. A background sweep
  // has no authenticated actor, so it never impersonates one.
  const doctorId = consultation.doctorId;
  if (!doctorId) return skipped(source, "no_doctor", consultationId);

  // Authorization and the final existing-note/settled checks happen again in
  // the DB transaction after the slow provider resolves. It never updates a note.
  const { persisted, fallback } = await extractAndPersistDraft(rawText, {
    extract: extractClinicalDraft,
    persist: (draft, metadata) => createClinicalDraft(consultationId, clinicId, draft, source, metadata, db),
  });
  if (!persisted.created || !persisted.note) {
    return { ...skipped(source, persisted.reason ?? "note_already_exists", consultationId),
      ...(persisted.note ? { note: persisted.note } : {}) };
  }
  const note = persisted.note;
  const draft = note.content as NoteContent;
  logEvent("draft.generated", { consultationId, clinicId, noteId: note.id, source, actorId, fallback });
  if (fallback) return { kind: "fallback", noteId: note.id, note, draft, reason: "AI draft generation was unavailable." };
  return { kind: "created", noteId: note.id, note, draft };
}

/**
 * Background sweep for consultations that were transcribed but never drafted.
 *
 * Deliberately delayed rather than hooked onto transcription completion. The
 * transcription worker runs *because the doctor's own poll woke it*, so
 * generating there would race the browser's `/generate` call and pay for two AI
 * generations on every consultation. Waiting a short window means the normal
 * path always wins, and this only ever catches visits nobody handled.
 *
 * Bounded per run and safe to call concurrently: the note guard makes a
 * duplicate a no-op, not a corruption.
 */
export async function drainDraftGeneration(limit = 3): Promise<void> {
  const service = createServiceRoleClient();
  const cutoff = new Date(Date.now() - DRAFT_SWEEP_AFTER_SECONDS * 1000).toISOString();
  const windowStart = new Date(
    Date.now() - DRAFT_SWEEP_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await service
    .from("transcripts")
    .select(
      "consultation_id, clinic_id, created_at, consultations!inner(id, status, doctor_id, clinical_notes(id))"
    )
    .lt("created_at", cutoff)
    .gt("created_at", windowStart)
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    logWarn("draft.sweep_query_failed", { message: error.message });
    return;
  }

  let generated = 0;
  for (const row of data ?? []) {
    if (generated >= limit) return;

    const consultation = (row as { consultations?: unknown }).consultations;
    // PostgREST returns the embedded row as an object for this FK shape.
    const embedded = (Array.isArray(consultation) ? consultation[0] : consultation) as
      | { id?: string; status?: string; doctor_id?: string | null; clinical_notes?: unknown }
      | null;

    if (!embedded?.id) continue;
    if (SETTLED_STATUSES.includes(String(embedded.status ?? ""))) continue;

    const notes = embedded.clinical_notes;
    const hasNote = Array.isArray(notes) ? notes.length > 0 : Boolean(notes);
    if (hasNote) continue;

    const result = await generateDraftForConsultation({
      consultationId: String(embedded.id),
      clinicId: String(row.clinic_id),
      actorId: null,
      source: "background",
      client: service,
    }).catch((sweepError) => {
      logError("draft.sweep_item_failed", sweepError, { consultationId: String(embedded.id) });
      return null;
    });

    if (result && (result.kind === "created" || result.kind === "fallback")) {
      generated += 1;
    }
  }
}
