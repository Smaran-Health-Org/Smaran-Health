/**
 * Sarvam probe — continuous PCM stream (AudioWorklet).
 *
 * Unlike `pcm-window-worklet.js` (which cuts 15–25 s windows for REST), this
 * processor never cuts: it posts fixed ~100 ms PCM16 chunks so the browser can
 * forward them to Sarvam's realtime WebSocket.
 *
 * Messages OUT:
 *   PCM_CHUNK { pcm16: ArrayBuffer }   transferred, ~100 ms of 16 kHz mono
 *   STOPPED   {}                        ack after FLUSH
 *
 * Messages IN:
 *   STOP {}    flush the remainder, then post PCM_CHUNK followed by STOPPED
 */

const DEFAULT_CHUNK_MS = 100;

class PcmStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSamples = Math.max(
      160,
      Math.round(((options?.processorOptions?.chunkMs ?? DEFAULT_CHUNK_MS) / 1000) * sampleRate)
    );
    this.buffer = new Int16Array(this.chunkSamples);
    this.writeIdx = 0;
    this.active = true;

    this.port.onmessage = (event) => {
      const message = event?.data;
      if (message?.type !== "STOP") return;
      this.active = false;
      this.flush();
      this.port.postMessage({ type: "STOPPED" });
    };
  }

  flush() {
    if (this.writeIdx === 0) return;
    const out = this.buffer.slice(0, this.writeIdx);
    this.port.postMessage({ type: "PCM_CHUNK", pcm16: out.buffer }, [out.buffer]);
    this.writeIdx = 0;
    this.buffer = new Int16Array(this.chunkSamples);
  }

  process(inputs) {
    if (!this.active) return true;
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      const raw = channel[i];
      const sample = raw > 1 ? 1 : raw < -1 ? -1 : raw;
      this.buffer[this.writeIdx] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.writeIdx += 1;
      if (this.writeIdx === this.chunkSamples) this.flush();
    }
    return true;
  }
}

registerProcessor("pcm-stream", PcmStreamProcessor);
