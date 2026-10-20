import "server-only";
import { lookup } from "node:dns/promises";
import {
  logSarvam,
  logSarvamError,
} from "@/lib/ai/sarvam-log";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import {
  SARVAM_STT_MODEL,
  createBatchUploadUrl,
  downloadBatchTranscript,
  getBatchJobStatus,
  initiateBatchJob,
  mimeTypeToExtension,
  putBatchFile,
  startBatchJob,
} from "@/lib/ai/sarvam";
import { classifyTranscriptionFailure } from "./failure-codes";
import { AUDIO_BUCKET } from "./storage";
import {
  TRANSCRIPTION_REPOLL_SECONDS,
  type AudioTranscriptionStepAdapter,
  type DurableRecording,
  type TranscriptionStepOutcome,
} from "./transcription-adapter";

/**
 * How long one claim may spend waiting for a batch job, and how often it looks.
 * The budget sits far below the route's execution limit so a slow job is
 * released back to the durable queue rather than killed mid-flight.
 *
 * The cadence starts fast because the provider usually finishes short visits in
 * a few seconds: a flat 5 s sleep spent most of a 6.7 s step asleep, having
 * already polled a "Pending" job at the moment it was about to complete. Later
 * intervals back off so a long visit does not hammer the status endpoint.
 */
const PROBE_BUDGET_MS = 25_000;
const PROBE_INTERVALS_MS = [500, 700, 900, 1_200, 1_800, 2_500, 3_000];

/**
 * TEMPORARY: measures the sandbox's own egress before the provider flow starts.
 *
 * Production runs have shown every control call taking ~2.7 s (and the first one
 * ~15 s) in this invocation while an identical call from a normal route handler
 * answers in ~250 ms. Timing DNS and two unauthenticated GETs here separates
 * "this sandbox's network" from "Sarvam's authenticated backend" instead of
 * inferring it from aggregated timings. Remove once the cause is known.
 */
async function logEgressProbe(): Promise<void> {
  const base = "https://api.sarvam.ai/speech-to-text/job/v1";
  const apiKey = process.env.SARVAM_API_KEY?.trim() ?? "";

  const time = async (url: string, init: RequestInit) => {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, { ...init, cache: "no-store" });
      await response.arrayBuffer();
      return { ms: Date.now() - startedAt, status: response.status };
    } catch (error) {
      return { ms: Date.now() - startedAt, status: error instanceof Error ? error.message : "error" };
    }
  };

  const dnsStartedAt = Date.now();
  let dnsMs: number | string;
  try {
    await lookup("api.sarvam.ai", { all: true });
    dnsMs = Date.now() - dnsStartedAt;
  } catch (error) {
    dnsMs = error instanceof Error ? `error:${error.message}` : "error";
  }

  // Non-mutating probes only: a status GET names a job that does not exist, and
  // upload-files for a job that does not exist is rejected without side effects.
  const authHeaders = { "api-subscription-key": apiKey };
  const getAuth = await time(`${base}/does-not-exist/status`, { method: "GET", headers: authHeaders });

  const jsonBody = JSON.stringify({ job_id: "does-not-exist", files: ["probe.webm"] });
  const postString = await time(`${base}/upload-files`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(jsonBody, "utf8")),
    },
    body: jsonBody,
  });
  const postBytes = await time(`${base}/upload-files`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: new Uint8Array(Buffer.from(jsonBody, "utf8")),
  });

  logSarvam("net_probe", {
    dnsMs,
    getAuthMs: getAuth.ms,
    getAuthStatus: getAuth.status,
    postStringMs: postString.ms,
    postStringStatus: postString.status,
    postBytesMs: postBytes.ms,
    postBytesStatus: postBytes.status,
  });
}

async function downloadRecordingChunk(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await createStorageAdminClient()
    .storage.from(AUDIO_BUCKET)
    .download(storagePath);
  if (error || !data) throw new Error("recording_chunk_unavailable");
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * How many chunk downloads may be in flight at once.
 *
 * The recorder slices audio every 10 s, so an ordinary consultation is 100+
 * chunks. Fetching them one at a time made the doctor's wait the sum of every
 * Storage round trip, which was the largest avoidable cost in the pipeline.
 * Still bounded: an unbounded fan-out would open 100+ sockets from a single
 * invocation and multiply peak memory pressure for no extra throughput.
 */
const CHUNK_DOWNLOAD_CONCURRENCY = 16;

/**
 * Concatenates the ordered chunk blobs into one continuous audio buffer. Chunks
 * are stored raw in sequence order, so byte-wise concatenation reconstructs the
 * original MediaRecorder stream.
 *
 * Downloads run concurrently, so completion order is arbitrary — ordering comes
 * only from `sequenceNumber`, because each download writes into the slot for its
 * own position instead of being appended. A chunk that fails aborts the step
 * before anything is uploaded, so a partial assembly can never reach the
 * provider.
 */
async function assembleRecording(
  recording: DurableRecording
): Promise<{ audioBuffer: ArrayBuffer; totalBytes: number }> {
  const ordered = [...recording.chunks].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  if (ordered.length === 0) throw new Error("recording_chunks_unavailable");

  const parts = new Array<Uint8Array | undefined>(ordered.length);
  let nextIndex = 0;
  let failure: unknown = null;

  async function drain(): Promise<void> {
    while (failure === null) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= ordered.length) return;
      const chunk = ordered[index];
      try {
        parts[index] = await downloadRecordingChunk(chunk.storagePath);
      } catch (error) {
        // A missing or un-finalized chunk is a distinct, actionable failure that
        // would otherwise be invisible behind a generic pipeline error. Keep the
        // first failure and stop pulling new work.
        failure ??= error;
        logSarvamError("adapter.chunk_download_failed", {
          traceId: recording.recordingId,
          sequenceNumber: chunk.sequenceNumber,
          storagePath: chunk.storagePath,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CHUNK_DOWNLOAD_CONCURRENCY, ordered.length) },
      drain
    )
  );
  if (failure) throw failure;

  // `filter` preserves index order, so this is still sequence order. The length
  // check makes a silently-dropped slot impossible to stitch into a short file.
  const present = parts.filter((part): part is Uint8Array => part !== undefined);
  if (present.length !== ordered.length) {
    throw new Error("recording_chunks_incomplete");
  }

  const totalBytes = present.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of present) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return { audioBuffer: combined.buffer as ArrayBuffer, totalBytes };
}

/**
 * Sarvam Batch STT as a resumable state machine.
 *
 * Each `step()` call performs one bounded unit of work driven by the persisted
 * `sarvam_phase`, so no single serverless invocation holds a long poll:
 *
 *   null ──initiate──▶ initiated ──upload──▶ uploaded ──start──▶ started
 *        └─▶ started ──one status probe──▶ completed ──download──▶ transcript
 *
 * A healthy-but-running job returns `deferred`, which releases the claim while
 * keeping the same job id, so the next run resumes by polling alone instead of
 * re-uploading audio the provider would bill again.
 *
 * This is the approved server-side provider for Indian languages and code-mixed
 * Hinglish. When SARVAM_API_KEY is missing it fails closed rather than
 * fabricating a transcript.
 */
export function sarvamAudioTranscriptionStepAdapter(): AudioTranscriptionStepAdapter {
  return {
    async step(recording, resume, record): Promise<TranscriptionStepOutcome> {
      // Correlates every Sarvam log line for one recording attempt.
      const traceId = recording.recordingId;
      const startedAt = Date.now();

      if (!process.env.SARVAM_API_KEY?.trim()) {
        logSarvamError("adapter.not_configured", {
          traceId,
          consultationId: recording.consultationId,
        });
        return {
          kind: "failed",
          code: "provider_not_configured",
          message: "No speech-to-text provider is configured.",
        };
      }

      const mimeType = recording.format ?? "audio/webm";
      const fileName = `recording-${recording.recordingId}.${mimeTypeToExtension(mimeType)}`;

      try {
        const needsUpload = resume.phase === null || resume.phase === "initiated";

        // TEMPORARY: separates a slow sandbox from a slow provider for this exact
        // invocation. Cheap (one DNS lookup, two unauthenticated GETs).
        await logEgressProbe();

        // ── Steps 1–2: prepare the job while the audio is being assembled ─────
        // Creating the job and presigning the upload URL depend on each other but
        // not on the audio, so they run concurrently with the chunk downloads. The
        // doctor's wait becomes the slower of the two instead of their sum.
        const prepareStartedAt = Date.now();
        const preparation = (async () => {
          let preparedJobId = resume.jobId;
          if (!preparedJobId) {
            logSarvam("adapter.start", {
              traceId,
              consultationId: recording.consultationId,
              format: mimeType,
              chunkCount: recording.chunks.length,
            });
            preparedJobId = await initiateBatchJob({ mode: "codemix", withDiarization: true });
            // Persisted before anything billable follows, so a crash here leaves a
            // resumable job id rather than an orphaned, paid-for job.
            await record({ jobId: preparedJobId, phase: "initiated" });
          } else {
            logSarvam("adapter.resuming", {
              traceId,
              jobId: preparedJobId,
              phase: resume.phase,
            });
          }
          if (!needsUpload) {
            return { jobId: preparedJobId, uploadUrl: null, prepareMs: Date.now() - prepareStartedAt };
          }
          const uploadUrl = await createBatchUploadUrl({ jobId: preparedJobId, fileName });
          return { jobId: preparedJobId, uploadUrl, prepareMs: Date.now() - prepareStartedAt };
        })();
        // Keeps a preparation failure from surfacing as an unhandled rejection if
        // the assembly below throws first; the awaited value still reports it.
        void preparation.catch(() => undefined);

        const assembleStartedAt = Date.now();
        const assembled = needsUpload ? await assembleRecording(recording) : null;
        const assembleMs = assembled ? Date.now() - assembleStartedAt : 0;
        const { jobId, uploadUrl, prepareMs } = await preparation;

        // ── Step 2: get the audio to Sarvam ──────────────────────────────────
        if (assembled && uploadUrl) {
          const put = await putBatchFile({
            jobId,
            fileUrl: uploadUrl,
            audioBuffer: assembled.audioBuffer,
            mimeType,
          });
          logSarvam("adapter.assembled", {
            traceId,
            mimeType,
            totalBytes: assembled.totalBytes,
            chunkCount: recording.chunks.length,
            assembleMs,
            prepareMs,
            uploadMs: put.durationMs,
            totalMs: Date.now() - startedAt,
          });
          await record({ jobId, phase: "uploaded" });
        }

        // ── Step 3: start processing ─────────────────────────────────────────
        if (resume.phase !== "started" && resume.phase !== "completed") {
          // A resumed attempt can ask to start a job an earlier attempt already
          // started. That is not a rejection; the status probe below is what
          // decides the outcome.
          const start = await startBatchJob(jobId);
          if (start.alreadyStarted) {
            logSarvam("adapter.start_already_applied", { traceId, jobId });
          }
          await record({ jobId, phase: "started" });
        }

        // ── Step 4: bounded status probing ───────────────────────────────────
        // Deliberately bounded (~25 s) rather than the old 5-minute poll. The
        // job id is already persisted, so being killed here costs nothing: the
        // next claim resumes by polling the same job instead of re-uploading.
        let outputFiles = resume.outputFiles ?? [];
        if (resume.phase !== "completed") {
          const probeStartedAt = Date.now();
          let status = await getBatchJobStatus(jobId);
          let probes = 1;
          let backoffIndex = 0;

          while (
            (status.jobState === "Accepted" ||
              status.jobState === "Pending" ||
              status.jobState === "Running") &&
            Date.now() - probeStartedAt < PROBE_BUDGET_MS
          ) {
            const waitMs = PROBE_INTERVALS_MS[Math.min(backoffIndex, PROBE_INTERVALS_MS.length - 1)];
            backoffIndex += 1;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            status = await getBatchJobStatus(jobId);
            probes += 1;
          }

          if (status.jobState === "Failed") {
            const detail =
              status.fileFailures[0]?.errorMessage ??
              status.fileFailures[0]?.exceptionName ??
              status.errorMessage ??
              "Sarvam reported the job failed.";
            logSarvamError("adapter.job_failed", {
              traceId,
              jobId,
              jobState: status.jobState,
              failedFileCount: status.failedFilesCount,
              fileError: status.fileFailures[0]?.errorMessage ?? null,
              exceptionName: status.fileFailures[0]?.exceptionName ?? null,
            });
            return { kind: "failed", code: "provider_job_failed", message: detail };
          }
          if (status.jobState !== "Completed") {
            logSarvam("adapter.still_running", {
              traceId,
              jobId,
              jobState: status.jobState,
              probes,
              probeMs: Date.now() - probeStartedAt,
              totalMs: Date.now() - startedAt,
            });
            // Not a failure: the claim is released and the same job is polled
            // again shortly, so a long consultation never looks like an error.
            return {
              kind: "deferred",
              delaySeconds: TRANSCRIPTION_REPOLL_SECONDS,
              message: `Sarvam job is ${status.jobState}.`,
            };
          }
          outputFiles = status.outputFiles;
          await record({ jobId, phase: "completed", outputFiles });
        }

        // ── Step 5: collect the transcript ───────────────────────────────────
        const { transcript, languageCode, languageProbability, diarizedTurns } =
          await downloadBatchTranscript(jobId, outputFiles);
        if (!transcript.trim()) {
          logSarvamError("adapter.empty_transcript", { traceId, jobId });
          return {
            kind: "failed",
            code: "empty_transcript",
            message: "The provider returned no speech for this recording.",
          };
        }

        logSarvam("adapter.completed", {
          traceId,
          jobId,
          languageCode,
          languageProbability,
          totalMs: Date.now() - startedAt,
          transcriptChars: transcript.length,
        });
        return {
          kind: "completed",
          rawText: transcript,
          modelVersion: SARVAM_STT_MODEL,
          languageCode,
          diarizedTurns: diarizedTurns.length > 0 ? diarizedTurns : undefined,
        };
      } catch (error) {
        const { code, message } = classifyTranscriptionFailure(error);
        logSarvamError("adapter.step_failed", {
          traceId,
          failureCode: code,
          durationMs: Date.now() - startedAt,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: message,
        });
        return { kind: "failed", code, message };
      }
    },
  };
}

