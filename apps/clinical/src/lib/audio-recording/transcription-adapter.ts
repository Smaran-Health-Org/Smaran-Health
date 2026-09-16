/** Provider-neutral boundary; browser live speech is never clinical truth. */
export type DurableRecording = { recordingId: string; consultationId: string; clinicId: string; format: string | null; chunks: Array<{ sequenceNumber: number; storagePath: string }> };

export class AudioTranscriptionUnavailableError extends Error {
  constructor() { super("No approved audio transcription provider is configured"); }
}

export interface AudioTranscriptionAdapter {
  transcribe(recording: DurableRecording): Promise<{ rawText: string; modelVersion: string }>;
}

export function configuredAudioTranscriptionAdapter(): AudioTranscriptionAdapter {
  // Vendor selection, DPA, retention, and clinical evaluation remain explicit
  // deployment decisions. Do not route clinical audio to an unrelated model.
  throw new AudioTranscriptionUnavailableError();
}
