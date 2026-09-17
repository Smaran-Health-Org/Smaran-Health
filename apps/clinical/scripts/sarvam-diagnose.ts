#!/usr/bin/env tsx
/**
 * End-to-end Sarvam Batch STT diagnostic.
 *
 * Reproduces the exact production flow (initiate → upload → start → poll →
 * download) with a short synthetic silent WAV, so an API-side problem (auth,
 * quota, model name, unreachable storage, stuck job) surfaces immediately and
 * independently of the app UI.
 *
 * Usage: npm run sarvam:diagnose
 */

import { config } from "dotenv";
import {
  SARVAM_STT_MODEL,
  downloadBatchTranscript,
  getBatchJobStatus,
  initiateBatchJob,
  startBatchJob,
  uploadBatchFile,
} from "../src/lib/ai/sarvam";
import { recentSarvamLog } from "../src/lib/ai/sarvam-log";

config({ path: ".env.local" });
config({ path: ".env" });

/** Builds a valid 16-bit mono PCM WAV of silence (default ~3 seconds). */
function silentWav(seconds = 3, sampleRate = 16_000): ArrayBuffer {
  const sampleCount = Math.floor(seconds * sampleRate);
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  // Samples are already zero-filled (silence).
  return buffer;
}

async function main() {
  const apiKey = process.env.SARVAM_API_KEY?.trim();
  console.log(`Model:    ${SARVAM_STT_MODEL}`);
  console.log(`API key:  ${apiKey ? `present (${apiKey.length} chars)` : "MISSING"}`);
  if (!apiKey) {
    console.log("\nCannot continue without SARVAM_API_KEY in apps/clinical/.env.local");
    process.exitCode = 1;
    return;
  }

  const audio = silentWav(3);
  const fileName = "diagnose-silence.wav";
  console.log(`Audio:    ${audio.byteLength} bytes of ${fileName}\n`);

  const startedAt = Date.now();
  const jobId = await initiateBatchJob({ mode: "codemix" });
  console.log(`1/5 initiated        jobId=${jobId}`);

  await uploadBatchFile({ jobId, fileName, audioBuffer: audio, mimeType: "audio/wav" });
  console.log("2/5 uploaded         ok");

  await startBatchJob(jobId);
  console.log("3/5 started          ok");

  let status = await getBatchJobStatus(jobId);
  const deadline = Date.now() + 240_000;
  while (
    (status.jobState === "Accepted" || status.jobState === "Pending" || status.jobState === "Running") &&
    Date.now() < deadline
  ) {
    console.log(`4/5 polling          state=${status.jobState} elapsed=${Date.now() - startedAt}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    status = await getBatchJobStatus(jobId);
  }
  console.log(`4/5 final state      state=${status.jobState} outputs=${status.outputFiles.length}`);

  if (status.jobState === "Completed") {
    const { transcript, languageCode } = await downloadBatchTranscript(jobId, status.outputFiles);
    console.log(`5/5 transcript       ${transcript.length} chars, language=${languageCode}`);
    console.log(`RESULT: OK in ${Date.now() - startedAt}ms`);
  } else {
    console.log(`5/5 FAILED           error=${status.errorMessage ?? "(none reported)"}`);
    console.log(`RESULT: ${status.jobState} after ${Date.now() - startedAt}ms`);
    process.exitCode = 1;
  }

  console.log("\n--- Sarvam log tail ---");
  for (const entry of recentSarvamLog(25)) console.log(JSON.stringify(entry));
}

main().catch((error) => {
  console.error("\nDIAGNOSTIC ERROR:", error instanceof Error ? error.message : error);
  console.log("\n--- Sarvam log tail ---");
  for (const entry of recentSarvamLog(25)) console.log(JSON.stringify(entry));
  process.exitCode = 1;
});
