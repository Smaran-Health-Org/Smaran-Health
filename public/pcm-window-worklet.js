/**
 * Sarvam probe — PCM window capture (AudioWorklet).
 *
 * The main thread must create the context at 16 kHz so the browser's own resampler
 * does the anti-aliasing for us (never decimate by dropping samples):
 *
 *   const ctx = new AudioContext({ sampleRate: 16000 });
 *   await ctx.audioWorklet.addModule('/pcm-window-worklet.js');
 *   const node = new AudioWorkletNode(ctx, 'pcm-window', {
 *     channelCount: 1,
 *     processorOptions: { noiseFloorRms: 0.006 },
 *   });
 *
 * Messages OUT (same MessagePort, FIFO):
 *   PCM_WINDOW            { pcm16, start_s, end_s, duration_s, cutReason,
 *                           hasOverlap, overlap_s, sampleRate }
 *   CALIBRATED_NOISE_FLOOR{ noiseFloorRms, silenceThresholdRms, silenceCuttingEnabled }
 *   TAIL_FLUSHED          { finalWindowEmitted }  — always posted AFTER any final
 *                           PCM_WINDOW, which is what makes the stop race impossible
 *
 * Messages IN:
 *   START_PREFLIGHT_CALIBRATION   measure ~500 ms of room tone; emits no windows
 *   SET_NOISE_FLOOR_RMS { rms }   use a floor measured elsewhere
 *   FLUSH_TAIL                    emit the remainder, then acknowledge
 *   RECYCLE { buffer }            return a transferred buffer for reuse
 *
 * Trade-offs made here, deliberately:
 *   • Windows are cut on ~400 ms of silence once past 15 s, else hard-capped at 25 s.
 *     Only hard-cap cuts carry a 1.75 s overlap; a silence cut needs none.
 *   • `start_s` is the only clock. On a hard-cap cut the next window starts 1.75 s
 *     earlier, so a global byte offset is NOT time — never compute it that way.
 *   • Buffers are pooled and handed back by the main thread, so the audio thread does
 *     no large allocation or copy per window (a 800 kB `slice()` per window risks a
 *     dropout).
 *   • If the room is too loud for the clamp to be trusted, silence cutting is disabled
 *     and every window becomes a hard cap. A wrong high threshold would cut *inside*
 *     speech, which is worse than an extra overlap.
 */

const MIN_SILENCE_RMS = 0.004; // ≈ −48 dBFS
const MAX_SILENCE_RMS = 0.025; // ≈ −32 dBFS, the hard ceiling for "silence"
const NOISE_MULTIPLIER = 1.8;

function computeThreshold(noiseFloorRms) {
  const floor = Number(noiseFloorRms);
  const raw = (Number.isFinite(floor) && floor > 0 ? floor : 0.006) * NOISE_MULTIPLIER;
  return {
    threshold: Math.max(MIN_SILENCE_RMS, Math.min(MAX_SILENCE_RMS, raw)),
    // If the raw threshold exceeds the ceiling the room is louder than we are willing
    // to call "silence"; refuse to guess and let the hard cap drive instead.
    enabled: raw <= MAX_SILENCE_RMS,
  };
}

class PcmWindowProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.rate = sampleRate;

    this.minCutSamples = Math.floor(15 * this.rate);
    this.maxWindowSamples = Math.floor(25 * this.rate);
    this.overlapSamples = Math.floor(1.75 * this.rate);

    this.rmsBlockSize = Math.floor(0.05 * this.rate); // 50 ms
    this.rmsSumSq = 0;
    this.rmsSampleCount = 0;
    this.requiredSilenceBlocks = 8; // 8 × 50 ms = 400 ms
    this.consecutiveSilentBlocks = 0;

    const initialFloor = options?.processorOptions?.noiseFloorRms ?? 0.006;
    this.noiseFloorRms = initialFloor;
    const initial = computeThreshold(initialFloor);
    this.silenceThresholdRms = initial.threshold;
    this.silenceCuttingEnabled = initial.enabled;

    this.calibrating = false;
    this.calibrationBlocks = [];

    // Buffer pool: two steady-state buffers, handed back by the main thread.
    this.freeBuffers = [new Int16Array(this.maxWindowSamples), new Int16Array(this.maxWindowSamples)];
    this.buf = this.freeBuffers.pop();
    this.writeIdx = 0;
    this.tailScratch = new Int16Array(this.overlapSamples);

    this.windowStartSample = 0; // samples since capture began (clock for start_s)
    this.totalInputSamples = 0;
    this.recordingActive = true;

    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'RECYCLE') {
      if (msg.buffer instanceof ArrayBuffer && this.freeBuffers.length < 4) {
        this.freeBuffers.push(new Int16Array(msg.buffer));
      }
      return;
    }

    if (msg.type === 'SET_NOISE_FLOOR_RMS') {
      this.applyNoiseFloor(msg.rms);
      return;
    }

    if (msg.type === 'START_PREFLIGHT_CALIBRATION') {
      this.calibrating = true;
      this.calibrationBlocks = [];
      return;
    }

    if (msg.type === 'FLUSH_TAIL') {
      this.recordingActive = false;
      const emitted = this.emitWindow('stop-tail', false);
      // Posted after PCM_WINDOW on the same port, so the main thread cannot stop the
      // scheduler before the tail has been enqueued.
      this.port.postMessage({ type: 'TAIL_FLUSHED', finalWindowEmitted: emitted });
    }
  }

  applyNoiseFloor(rms) {
    this.noiseFloorRms = rms;
    const next = computeThreshold(rms);
    this.silenceThresholdRms = next.threshold;
    this.silenceCuttingEnabled = next.enabled;
  }

  emitWindow(cutReason, copyOverlap) {
    if (this.writeIdx === 0) return false;

    const out = this.buf;
    const start_s = Number((this.windowStartSample / this.rate).toFixed(3));
    const duration_s = Number((this.writeIdx / this.rate).toFixed(3));

    // Copy the overlap tail *before* transferring the buffer.
    let overlapSamples = 0;
    if (copyOverlap && this.writeIdx >= this.overlapSamples) {
      overlapSamples = this.overlapSamples;
      this.tailScratch.set(out.subarray(this.writeIdx - overlapSamples, this.writeIdx));
    }

    this.port.postMessage(
      {
        type: 'PCM_WINDOW',
        pcm16: out.buffer,
        sampleRate: this.rate,
        cutReason,
        hasOverlap: overlapSamples > 0,
        overlap_s: Number((overlapSamples / this.rate).toFixed(3)),
        start_s,
        end_s: Number((start_s + duration_s).toFixed(3)),
        duration_s,
        byteLength: this.writeIdx * 2,
      },
      [out.buffer]
    );

    // Switch to a pooled buffer. If none has been recycled yet, allocate once.
    this.buf = this.freeBuffers.pop() || new Int16Array(this.maxWindowSamples);

    if (overlapSamples > 0) {
      this.buf.set(this.tailScratch.subarray(0, overlapSamples), 0);
      this.writeIdx = overlapSamples;
      this.windowStartSample = this.totalInputSamples - overlapSamples;
    } else {
      this.writeIdx = 0;
      this.windowStartSample = this.totalInputSamples;
    }
    this.consecutiveSilentBlocks = 0;
    return true;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || !this.recordingActive) return true;

    for (let i = 0; i < channel.length; i += 1) {
      const raw = channel[i];
      const s = raw > 1 ? 1 : raw < -1 ? -1 : raw;

      this.rmsSumSq += s * s;
      this.rmsSampleCount += 1;

      if (this.rmsSampleCount === this.rmsBlockSize) {
        const blockRms = Math.sqrt(this.rmsSumSq / this.rmsBlockSize);
        this.rmsSumSq = 0;
        this.rmsSampleCount = 0;

        if (this.calibrating) {
          this.calibrationBlocks.push(blockRms);
          if (this.calibrationBlocks.length >= 10) {
            const sorted = [...this.calibrationBlocks].sort((a, b) => a - b);
            this.calibrating = false;
            // 30th percentile: the quietest part of a 500 ms room-tone capture.
            this.applyNoiseFloor(sorted[Math.floor(sorted.length * 0.3)]);
            this.port.postMessage({
              type: 'CALIBRATED_NOISE_FLOOR',
              noiseFloorRms: Number(this.noiseFloorRms.toFixed(5)),
              silenceThresholdRms: Number(this.silenceThresholdRms.toFixed(5)),
              silenceCuttingEnabled: this.silenceCuttingEnabled,
            });
          }
          continue; // pre-flight: do not buffer room tone into a visit window
        }

        if (blockRms < this.silenceThresholdRms) {
          this.consecutiveSilentBlocks += 1;
        } else {
          this.consecutiveSilentBlocks = 0;
        }
      }

      if (this.calibrating) continue;

      this.buf[this.writeIdx] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.writeIdx += 1;
      this.totalInputSamples += 1;

      const silenceCut =
        this.silenceCuttingEnabled &&
        this.writeIdx >= this.minCutSamples &&
        this.consecutiveSilentBlocks >= this.requiredSilenceBlocks;

      if (silenceCut) {
        this.emitWindow('silence', false);
      } else if (this.writeIdx >= this.maxWindowSamples) {
        this.emitWindow('hard-cap', true);
      }
    }
    return true;
  }
}

registerProcessor('pcm-window', PcmWindowProcessor);
