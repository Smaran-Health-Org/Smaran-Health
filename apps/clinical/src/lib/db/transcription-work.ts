import { createClient as createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { TranscriptionJobPhase } from "@/lib/audio-recording/transcription-adapter";

/**
 * Durable transcription work queue (migration 0098).
 *
 * The work row is created by the same transaction that finalizes a recording, so
 * an accepted recording can never lack a durable work item. The claim/record/
 * finish/fail helpers are service-role only because this is machine work with no
 * human requester — the same shape as the document pipeline.
 */

export type TranscriptionWorkClaim = {
  workId: string;
  audioFileId: string;
  consultationId: string;
  clinicId: string;
  audioFormat: string | null;
  attemptNumber: number;
  jobId: string | null;
  jobPhase: TranscriptionJobPhase | null;
  jobOutputFiles: string[] | null;
};

export type ConsultationRecordingStatus = {
  hasRecording: boolean;
  transcriptionStatus: string;
  transcriptionFailureCode: string | null;
  /** False once the queue has stopped trying and only a doctor retry can resume it. */
  retryScheduled: boolean;
};

function asPhase(value: unknown): TranscriptionJobPhase | null {
  return value === "initiated" || value === "uploaded" || value === "started" || value === "completed"
    ? value
    : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string");
  return items;
}

function claimRow(row: Record<string, unknown>): TranscriptionWorkClaim {
  return {
    workId: String(row.work_id),
    audioFileId: String(row.audio_file_id),
    consultationId: String(row.consultation_id),
    clinicId: String(row.clinic_id),
    audioFormat: typeof row.audio_format === "string" ? row.audio_format : null,
    attemptNumber: Number(row.attempt_number ?? 1),
    jobId: typeof row.job_id === "string" ? row.job_id : null,
    jobPhase: asPhase(row.job_phase),
    jobOutputFiles: asStringArray(row.job_output_files),
  };
}

/** Claims one due work item, or returns null when nothing is due. */
export async function claimTranscriptionWork(): Promise<TranscriptionWorkClaim | null> {
  const { data, error } = await createServiceRoleClient().rpc("claim_transcription_work");
  if (error) throw new Error("transcription_work_claim_failed");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return row ? claimRow(row) : null;
}

/** Persists how far the provider flow got so the next claim resumes it. */
export async function recordTranscriptionJob(
  workId: string,
  jobId: string,
  phase: TranscriptionJobPhase,
  outputFiles?: string[] | null
): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("record_transcription_job", {
    p_work_id: workId,
    p_job_id: jobId,
    p_phase: phase,
    p_output_files: outputFiles ?? null,
  });
  if (error) throw new Error("transcription_work_record_failed");
}

/** Releases a healthy-but-unfinished claim without consuming its retry budget. */
export async function deferTranscriptionWork(workId: string, delaySeconds = 20): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("defer_transcription_work", {
    p_work_id: workId,
    p_delay_seconds: delaySeconds,
  });
  if (error) throw new Error("transcription_work_defer_failed");
}

export async function finishTranscriptionWork(workId: string): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("finish_transcription_work", {
    p_work_id: workId,
  });
  if (error) throw new Error("transcription_work_finish_failed");
}

export async function failTranscriptionWork(workId: string, failureCode: string): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("fail_transcription_work", {
    p_work_id: workId,
    p_failure_code: failureCode,
  });
  if (error) throw new Error("transcription_work_fail_failed");
}

/** Doctor-requested retry. Authorized by the RPC against the caller's own clinic. */
export async function retryTranscriptionForConsultation(consultationId: string): Promise<void> {
  const client = await createServerClient();
  const { error } = await client.rpc("retry_transcription_work", {
    p_consultation_id: consultationId,
  });
  if (error) throw new Error("transcription_work_retry_failed");
}

/**
 * Doctor-visible transcription state for a consultation. The caller (the
 * transcript route) must already have authorized the doctor and the clinic
 * before calling this.
 *
 * `audio_files` is read under the caller's own JWT so clinic RLS still applies.
 * The queue row is read with the service role because `transcription_work` is
 * deliberately service-only — it is internal machine state, not clinical data,
 * and exposing it to `authenticated` would widen the schema surface for no
 * benefit.
 */
export async function getConsultationRecordingStatus(
  consultationId: string,
  clinicId: string
): Promise<ConsultationRecordingStatus | null> {
  const client = await createServerClient();
  const { data, error } = await client
    .from("audio_files")
    .select("id, transcription_status, transcription_failure_code")
    .eq("consultation_id", consultationId)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  // The queue only stops retrying once the work item is parked at
  // `next_attempt_at = 'infinity'`; that is what makes a failure terminal from
  // the doctor's point of view rather than something worth waiting for.
  const { data: work } = await createServiceRoleClient()
    .from("transcription_work")
    .select("status")
    .eq("audio_file_id", String(data.id))
    .maybeSingle();

  const workStatus = work ? String(work.status) : null;

  return {
    hasRecording: true,
    transcriptionStatus: String(data.transcription_status ?? "pending"),
    transcriptionFailureCode:
      typeof data.transcription_failure_code === "string" ? data.transcription_failure_code : null,
    retryScheduled: workStatus === null || workStatus === "pending" || workStatus === "processing",
  };
}
