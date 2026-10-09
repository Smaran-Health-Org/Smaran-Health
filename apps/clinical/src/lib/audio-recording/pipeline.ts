import "server-only";
import { logSarvam, logSarvamError } from "@/lib/ai/sarvam-log";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  claimTranscriptionWork,
  deferTranscriptionWork,
  failTranscriptionWork,
  finishTranscriptionWork,
  type TranscriptionWorkClaim,
} from "@/lib/db/transcription-work";
import { transcribeClaimedWork } from "./process";
import { inferSpeakerRoles, type DiarizedTurn } from "./speaker-roles";

/**
 * Durable transcription worker.
 *
 * Transcription used to run as `after(() => transcribe().catch(() => undefined))`
 * with no work row, so a killed invocation stranded the recording and nothing
 * ever retried it. This drains the committed `transcription_work` queue instead,
 * which means losing a request can no longer lose the work.
 *
 * Driven by the same internal cron as the document pipeline, so it inherits the
 * existing scheduling and CRON_SECRET authentication rather than inventing a
 * second scheduled entry point.
 */

/** Writes the transcript, replacing any earlier attempt for the consultation. */
async function persistTranscript(
  claim: TranscriptionWorkClaim,
  rawText: string,
  modelVersion: string,
  languageCode: string | null,
  diarizedTurns: DiarizedTurn[]
): Promise<void> {
  const service = createServiceRoleClient();
  const { data: existing, error: lookupError } = await service
    .from("transcripts")
    .select("id")
    .eq("consultation_id", claim.consultationId)
    .eq("clinic_id", claim.clinicId)
    .maybeSingle();
  if (lookupError) throw new Error("transcript_persist_failed");

  // The detected language is recorded so a mis-detection stays auditable — it
  // was previously logged and then thrown away, leaving no way to answer
  // "was this consultation transcribed as the right language?". Only written
  // when the provider reported one, so a later pass cannot blank an earlier value.
  const languageFields = languageCode ? { language_codes: [languageCode] } : {};

  // Roles are inferred once, here, rather than on every render: every reader then
  // sees the same attribution, and the doctor's correction is stored alongside it
  // instead of being re-derived. Left untouched when the provider returned no
  // diarization, so a later pass cannot blank an earlier attribution.
  const diarizationFields = diarizedTurns.length
    ? { diarized_turns: diarizedTurns, speaker_roles: inferSpeakerRoles(diarizedTurns) }
    : {};

  const write = existing
    ? service
        .from("transcripts")
        .update({ raw_text: rawText, model_version: modelVersion, ...languageFields, ...diarizationFields })
        .eq("id", existing.id)
        .eq("clinic_id", claim.clinicId)
    : service.from("transcripts").insert({
        consultation_id: claim.consultationId,
        clinic_id: claim.clinicId,
        raw_text: rawText,
        model_version: modelVersion,
        ...languageFields,
        ...diarizationFields,
      });

  const { error } = await write;
  if (error) throw new Error("transcript_persist_failed");
}

/** Runs a bounded, idempotent slice. Durable DB work remains if this process dies. */
export async function drainTranscriptionWork(limit = 3): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    let claim: TranscriptionWorkClaim | null = null;
    try {
      claim = await claimTranscriptionWork();
    } catch {
      // A claim failure is usually the schema being unavailable; the committed
      // work row survives, so the next tick simply tries again.
      return;
    }
    if (!claim) return;

    try {
      const outcome = await transcribeClaimedWork(claim);

      if (outcome.kind === "completed") {
        await persistTranscript(
          claim,
          outcome.rawText,
          outcome.modelVersion,
          outcome.languageCode ?? null,
          outcome.diarizedTurns ?? []
        );
        await finishTranscriptionWork(claim.workId);
        logSarvam("worker.completed", {
          workId: claim.workId,
          consultationId: claim.consultationId,
          attemptNumber: claim.attemptNumber,
          transcriptChars: outcome.rawText.length,
        });
        continue;
      }

      if (outcome.kind === "deferred") {
        // Healthy job, not finished. Released without consuming the retry budget.
        await deferTranscriptionWork(claim.workId, outcome.delaySeconds);
        logSarvam("worker.deferred", {
          workId: claim.workId,
          consultationId: claim.consultationId,
          delaySeconds: outcome.delaySeconds,
          message: outcome.message,
        });
        continue;
      }

      await failTranscriptionWork(claim.workId, outcome.code);
      logSarvamError("worker.failed", {
        workId: claim.workId,
        consultationId: claim.consultationId,
        attemptNumber: claim.attemptNumber,
        failureCode: outcome.code,
        message: outcome.message,
      });
    } catch (error) {
      // Anything thrown outside the adapter — storage, transcript write — still
      // has to release the claim, otherwise the row sits in `processing` until
      // its lease expires and the doctor sees nothing.
      const message = error instanceof Error ? error.message : String(error);
      const failureCode = message.includes("transcript_persist_failed")
        ? "persist_failed"
        : message.includes("recording_chunks_unavailable") ||
            message.includes("recording_chunk_unavailable")
          ? "chunks_unavailable"
          : "provider_unavailable";
      await failTranscriptionWork(claim.workId, failureCode).catch(() => undefined);
      logSarvamError("worker.unhandled_failure", {
        workId: claim.workId,
        consultationId: claim.consultationId,
        failureCode,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: message,
      });
    }
  }
}

/**
 * Best-effort wakeup so provider steps do not have to wait for the next cron
 * tick. Called from two places:
 *   • after a recording is finalized (the first steps start within seconds), and
 *   • from the transcript poll the workflow already makes every few seconds
 *     while it waits.
 *
 * That second caller is the important one. The durable queue is normally drained
 * once a minute by the document-pipeline cron, so a provider job that needs
 * several status polls used to advance at one poll per minute — turning a
 * 30-second provider job into minutes of doctor-facing waiting. Letting the
 * client's own poll drive the drain means progress is paced by how often the
 * doctor's screen refreshes, not by the cron.
 *
 * Correctness never depends on this call: the committed work row is the source
 * of truth, and claiming is atomic, so concurrent callers cannot double-process.
 */
export function wakeTranscriptionWorker(limit = 1): void {
  void drainTranscriptionWork(limit).catch(() => undefined);
}
