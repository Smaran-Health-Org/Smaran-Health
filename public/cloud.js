/**
 * Cloud (Vercel) UI for the Sarvam probe.
 *
 * A serverless function cannot hold a run, so this page drives the state machine itself
 * — initiate → presign → PUT → start → poll → download — and measures every hop with
 * `performance.now()`.
 *
 * Three rules this file keeps:
 *   • The upload goes straight from the browser to Sarvam's presigned storage URL. That
 *     stays under Vercel's 4.5 MB body limit and doubles as the CORS probe (§7.11).
 *   • Status polling is globally rate-limited to 20 req/min, which is Sarvam's batch
 *     limit. Two concurrent A/B jobs therefore share one budget instead of tripling it.
 *   • The log and the run history hold timings, sizes and ids — **never** transcript
 *     text and never audio. Benchmarking must not become a PHI leak.
 */

const el = (id) => document.getElementById(id);

import { stitchWindows, zipPhrases } from "/chunk-stitch.js";

const RUNS_KEY = "sarvam-probe-runs";
const LOGS_KEY = "sarvam-probe-logs";
const MAX_LOGS = 500;

/** Batch endpoints allow 20 req/min per account. One status call per 3 s is the ceiling. */
const STATUS_MIN_GAP_MS = 3000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const state = {
  recorder: null,
  chunks: [],
  mimeType: "audio/webm",
  startedAt: 0,
  timerId: null,
  stream: null,
  preJobs: null,
  lastBlob: null,
  lastMime: "audio/webm",
  lastDuration: 0,
  lastFileName: "",
  busy: false,
  clips: [],
  selectedClip: null,
  activeClip: null,
  hybrid: null,
  hybridSummary: null,
  liveSource: null,
  realtimeKey: null,
  realtimeModel: "saaras:v3-realtime",
};

// ── formatting ───────────────────────────────────────────────────────────────

const fmtMs = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtSec = (s) => (s == null ? "—" : s < 60 ? `${s.toFixed(0)} s` : `${(s / 60).toFixed(1)} min`);
const fmtKb = (bytes) => (bytes == null ? "—" : `${(bytes / 1024).toFixed(0)} KB`);
const fmtClock = (ms) => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const escapeHtml = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function extForMime(mime) {
  const clean = String(mime || "").split(";")[0].trim().toLowerCase();
  if (clean === "audio/mp4" || clean === "audio/x-m4a" || clean === "audio/aac") return "m4a";
  if (clean === "audio/ogg" || clean === "audio/opus") return "ogg";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "audio/wav" || clean === "audio/x-wav") return "wav";
  if (clean === "audio/flac") return "flac";
  if (clean === "audio/amr") return "amr";
  return "webm";
}

const MIME_BY_EXTENSION = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
  amr: "audio/amr",
};

function mimeForFile(file) {
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  return MIME_BY_EXTENSION[extension] || file?.type || "audio/webm";
}

// ── log ──────────────────────────────────────────────────────────────────────

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(LOGS_KEY) || "[]");
  } catch {
    return [];
  }
}

function log(level, message, extra) {
  const entry = { t: new Date().toISOString(), level, message, ...(extra ? { extra } : {}) };
  const entries = readLog();
  entries.push(entry);
  localStorage.setItem(LOGS_KEY, JSON.stringify(entries.slice(-MAX_LOGS)));
  renderLog();
  return entry;
}

function renderLog() {
  const box = el("log");
  if (!box) return;
  box.innerHTML = "";
  for (const entry of readLog().slice(-120).reverse()) {
    const row = document.createElement("div");
    row.className = `step ${entry.level === "error" ? "failed" : ""}`;
    const extra = entry.extra
      ? ` ${Object.entries(entry.extra)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : "";
    row.innerHTML = `<span class="name">${escapeHtml(new Date(entry.t).toLocaleTimeString())}</span><span class="ms">${escapeHtml(
      entry.level
    )}</span><span class="detail">${escapeHtml(entry.message + extra)}</span>`;
    box.appendChild(row);
  }
}

// ── config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  const config = await fetch("/api/config").then((r) => r.json());
  el("model").innerHTML = config.models.map((m) => `<option>${m}</option>`).join("");
  el("model").value = config.defaultModel;
  el("mode").innerHTML = config.modes.map((m) => `<option>${m}</option>`).join("");
  el("mode").value = "codemix";
  el("language").innerHTML = config.languages.map((m) => `<option>${m}</option>`).join("");
  const chip = el("key-state");
  chip.textContent = config.hasKey ? "API key loaded" : "API key missing on Vercel";
  chip.classList.add(config.hasKey ? "ok" : "bad");

  SUPABASE =
    config.supabaseUrl && config.supabaseKey
      ? {
          url: String(config.supabaseUrl).replace(/\/+$/, ""),
          key: config.supabaseKey,
          bucket: config.supabaseBucket || "probe-fixtures",
        }
      : null;

  state.realtimeKey = config.realtimeKey || null;
  state.realtimeModel = config.realtimeModel || "saaras:v3-realtime";

  const clipsChip = el("clips-backend");
  if (SUPABASE) {
    clipsChip.textContent = "shared · Supabase";
    clipsChip.classList.add("ok");
    el("save-clip-btn").disabled = false;
    loadClips().catch((error) =>
      setClipStatus(`Could not load clips: ${error.message}`, true)
    );
  } else {
    clipsChip.textContent = "not configured";
    clipsChip.classList.add("bad");
    el("save-clip-btn").disabled = true;
    setClipStatus(
      "Shared clips need SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the Vercel project.",
      true
    );
  }

  log("info", "config loaded", {
    hasKey: config.hasKey,
    runtime: config.runtime,
    sharedClips: Boolean(SUPABASE),
    realtime: Boolean(state.realtimeKey),
  });
}

// ── saved clips (shared Supabase project) ────────────────────────────────────

let SUPABASE = null;
const CLIPS_TABLE = "probe_fixtures";

function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE.key,
    Authorization: `Bearer ${SUPABASE.key}`,
    ...extra,
  };
}

async function sbJson(pathname, options = {}) {
  const response = await fetch(`${SUPABASE.url}${pathname}`, {
    ...options,
    headers: sbHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase ${response.status}`);
  }
  return data;
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function setClipStatus(message, bad = false) {
  const node = el("clip-status");
  node.textContent = message;
  node.style.color = bad ? "var(--bad)" : "";
}

async function loadClips() {
  if (!SUPABASE) return;
  const rows = await sbJson(`/rest/v1/${CLIPS_TABLE}?select=*&order=name.asc`);
  state.clips = Array.isArray(rows) ? rows : [];
  if (state.selectedClip && !state.clips.some((clip) => clip.id === state.selectedClip)) {
    state.selectedClip = null;
  }
  renderClips();
}

function renderClips() {
  const body = document.querySelector("#clips tbody");
  body.innerHTML = "";

  if (state.clips.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="6" class="muted small">No clips saved yet — record or pick audio, name it, then save.</td>`;
    body.appendChild(row);
    updateClipSelection();
    return;
  }

  for (const clip of state.clips) {
    const row = document.createElement("tr");
    if (clip.id === state.selectedClip) row.classList.add("selected");
    row.innerHTML = `
      <td>${escapeHtml(clip.name)}</td>
      <td class="muted small">${escapeHtml(clip.note || "—")}</td>
      <td>${clip.duration_sec ? `${Number(clip.duration_sec).toFixed(1)} s` : "—"}</td>
      <td>${fmtKb(Number(clip.bytes))}</td>
      <td>${clip.runs ?? 0}</td>
      <td>${clip.last_run_at ? new Date(clip.last_run_at).toLocaleString() : "—"}</td>`;
    row.addEventListener("click", () => selectClip(clip.id));
    row.addEventListener("dblclick", () => runClip(clip));
    body.appendChild(row);
  }
  updateClipSelection();
}

function updateClipSelection() {
  const clip = state.clips.find((item) => item.id === state.selectedClip) ?? null;
  el("run-clip-btn").disabled = !clip;
  el("delete-clip-btn").disabled = !clip;
  el("clip-selected").textContent = clip
    ? `${clip.name} · ${clip.duration_sec ? `${Number(clip.duration_sec).toFixed(1)} s` : "length unknown"} · ${fmtKb(
        Number(clip.bytes)
      )}`
    : "no clip selected";

  const audio = el("clip-audio");
  if (!clip) {
    audio.hidden = true;
    audio.removeAttribute("src");
  }
}

async function selectClip(id) {
  state.selectedClip = id;
  renderClips();
  const clip = state.clips.find((item) => item.id === id);
  if (!clip) return;

  state.lastDuration = Number(clip.duration_sec) || 0;
  el("clip-seconds").value = clip.duration_sec ? Number(clip.duration_sec).toFixed(1) : "";
  if (!el("clip-name").value.trim()) el("clip-name").value = clip.name;

  const audio = el("clip-audio");
  try {
    const signed = await sbJson(
      `/storage/v1/object/sign/${SUPABASE.bucket}/${encodeURIComponent(clip.storage_path)}`,
      { method: "POST", body: JSON.stringify({ expiresIn: 3600 }) }
    );
    const relative = signed?.signedURL || signed?.signedUrl;
    if (relative) {
      audio.src = relative.startsWith("http") ? relative : `${SUPABASE.url}/storage/v1${relative}`;
      audio.hidden = false;
    }
  } catch (error) {
    log("error", "clip preview unavailable", { message: String(error.message).slice(0, 160) });
  }
}

async function saveClip() {
  if (!SUPABASE) return;
  const blob = state.lastBlob;
  if (!blob) {
    setClipStatus("Record or select audio first, then save it.", true);
    return;
  }
  const name = el("clip-name").value.trim();
  if (!name) {
    setClipStatus("Give the clip a name first.", true);
    el("clip-name").focus();
    return;
  }

  const note = el("clip-note").value.trim();
  const mimeType = state.lastMime || blob.type || "audio/webm";
  const durationSec = resolveDuration(state.lastDuration);

  try {
    setClipStatus("Hashing…");
    const buffer = await blob.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    const id = sha256.slice(0, 12);

    const existing = await sbJson(
      `/rest/v1/${CLIPS_TABLE}?select=*&sha256=eq.${sha256}`
    );
    if (Array.isArray(existing) && existing.length > 0) {
      const row = existing[0];
      await sbJson(`/rest/v1/${CLIPS_TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name, note, duration_sec: durationSec ?? row.duration_sec }),
        headers: { Prefer: "return=minimal" },
      });
      setClipStatus(`Already saved — updated "${name}".`);
      await loadClips();
      selectClip(row.id);
      return;
    }

    const storagePath = `${id}.${extForMime(mimeType)}`;
    setClipStatus(`Uploading ${fmtKb(blob.size)}…`);
    const upload = await fetch(
      `${SUPABASE.url}/storage/v1/object/${SUPABASE.bucket}/${encodeURIComponent(storagePath)}`,
      {
        method: "POST",
        headers: sbHeaders({ "Content-Type": mimeType, "x-upsert": "true" }),
        body: blob,
      }
    );
    if (!upload.ok) {
      const detail = await upload.text().catch(() => "");
      throw new Error(detail.slice(0, 200) || `upload failed (${upload.status})`);
    }

    await sbJson(`/rest/v1/${CLIPS_TABLE}`, {
      method: "POST",
      body: JSON.stringify({
        id,
        name,
        note,
        duration_sec: durationSec ?? null,
        bytes: blob.size,
        mime_type: mimeType,
        sha256,
        storage_path: storagePath,
        source_name: blob.name || "recording",
        converted: false,
        runs: 0,
      }),
      headers: { Prefer: "return=minimal" },
    });

    setClipStatus(`Saved "${name}" · ${fmtKb(blob.size)} · ${durationSec ? `${durationSec.toFixed(1)} s` : "length unknown"}.`);
    el("clip-name").value = "";
    el("clip-note").value = "";
    log("info", "clip saved", { bytes: blob.size, seconds: durationSec ?? "?", sha: sha256.slice(0, 12) });
    await loadClips();
    selectClip(id);
  } catch (error) {
    setClipStatus(`Could not save clip: ${error.message}`, true);
    log("error", "clip save failed", { message: String(error.message).slice(0, 160) });
  }
}

async function runClip(clip) {
  if (!SUPABASE || !clip) return;
  if (state.busy) {
    setClipStatus("A run is already in progress.", true);
    return;
  }

  try {
    setClipStatus(`Loading ${clip.name}…`);
    const response = await fetch(
      `${SUPABASE.url}/storage/v1/object/${SUPABASE.bucket}/${encodeURIComponent(clip.storage_path)}`,
      { headers: sbHeaders() }
    );
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    const blob = await response.blob();

    state.lastBlob = blob;
    state.lastMime = clip.mime_type;
    state.lastDuration = Number(clip.duration_sec) || 0;
    state.activeClip = clip;
    el("clip-seconds").value = clip.duration_sec ? Number(clip.duration_sec).toFixed(1) : "";
    if (!el("label").value.trim()) el("label").value = clip.name;

    state.liveSource = runMode().startsWith("hybrid") ? "file" : null;
    state.hybridSummary = null;
    setClipStatus(`Running ${clip.name} (${fmtKb(blob.size)})…`);
    void sbJson(`/rest/v1/${CLIPS_TABLE}?id=eq.${encodeURIComponent(clip.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ runs: (clip.runs ?? 0) + 1, last_run_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    })
      .then(() => loadClips())
      .catch(() => {});

    await runPipeline(blob, clip.mime_type, state.lastDuration);
    state.activeClip = null;
    setClipStatus(`Finished ${clip.name} — see the run card above.`);
  } catch (error) {
    state.activeClip = null;
    setClipStatus(`Could not run clip: ${error.message}`, true);
    log("error", "clip run failed", { message: String(error.message).slice(0, 160) });
  }
}

async function runSelectedClip() {
  const clip = state.clips.find((item) => item.id === state.selectedClip);
  if (!clip) return;
  await runClip(clip);
}

async function deleteSelectedClip() {
  const clip = state.clips.find((item) => item.id === state.selectedClip);
  if (!clip) return;
  if (!confirm(`Delete clip "${clip.name}"? Run history in this browser is kept.`)) return;

  try {
    await sbJson(`/rest/v1/${CLIPS_TABLE}?id=eq.${encodeURIComponent(clip.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    const removedObject = await fetch(
      `${SUPABASE.url}/storage/v1/object/${SUPABASE.bucket}/${encodeURIComponent(clip.storage_path)}`,
      { method: "DELETE", headers: sbHeaders() }
    );
    if (!removedObject.ok) {
      log("warn", "clip object delete failed", { status: removedObject.status });
    }
    state.selectedClip = null;
    setClipStatus(`Deleted "${clip.name}".`);
    await loadClips();
  } catch (error) {
    setClipStatus(`Could not delete clip: ${error.message}`, true);
  }
}

/** Shares the summary only (no transcript, no audio) so results are comparable. */
async function shareRun(record) {
  if (!SUPABASE) return;
  try {
    await sbJson("/rest/v1/probe_runs", {
      method: "POST",
      body: JSON.stringify({
        run_id: `${Date.now()}-${record.variant}`,
        fixture_id: record.clipId ?? null,
        fixture_name: record.clipName ?? null,
        duration_sec: record.durationSec ?? null,
        transport: "batch",
        model: record.model,
        mode: record.mode,
        keep_alive: true,
        diarization: record.diarization,
        total_ms: record.totalMs,
        ratio: record.ratio,
        transcript_chars: record.transcriptChars ?? null,
        turn_count: record.turnCount ?? null,
        status: record.status,
        run_mode: record.runMode ?? (record.diarization ? "batch-on" : "batch-off"),
        first_text_ms: record.firstTextMs ?? null,
        segment_count: record.segmentCount ?? null,
        seam_warnings: record.seamWarnings ?? null,
      }),
      headers: { Prefer: "return=minimal" },
    });
  } catch (error) {
    log("warn", "run summary not shared", { message: String(error.message).slice(0, 160) });
  }
}

// ── recording ────────────────────────────────────────────────────────────────

function runMode() {
  return el("run-mode").value;
}

function diarizationForMode(mode = runMode()) {
  return mode !== "batch-off";
}

function pickMimeType() {
  for (const candidate of MIME_CANDIDATES) {
    if (window.MediaRecorder?.isTypeSupported?.(candidate)) return candidate;
  }
  return "";
}

async function startRecording() {
  const mode = runMode();
  if (mode === "hybrid-rest") {
    await startHybridRecording();
    return;
  }
  if (mode === "hybrid-stream") {
    await startStreamRecording();
    return;
  }

  state.hybridSummary = null;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    alert(`Microphone unavailable: ${error.message}`);
    log("error", "microphone unavailable", { reason: error.name });
    return;
  }

  state.mimeType = pickMimeType() || "audio/webm";
  state.chunks = [];
  state.recorder = new MediaRecorder(state.stream, { mimeType: state.mimeType });
  state.recorder.ondataavailable = (event) => {
    if (event.data?.size > 0) state.chunks.push(event.data);
  };
  state.recorder.onstop = handleStopped;
  state.recorder.start(1000);

  state.startedAt = Date.now();
  el("record-btn").disabled = true;
  el("record-btn").classList.add("recording");
  el("stop-btn").disabled = false;
  el("level").textContent = `format: ${state.mimeType}`;
  log("info", "recording started", { format: state.mimeType });

  state.timerId = setInterval(() => {
    el("timer").textContent = fmtClock(Date.now() - state.startedAt);
  }, 250);

  state.preJobs = null;
  if (el("pre-initiate").checked) {
    const diarization = diarizationForMode();
    el("level").textContent = "pre-initiating the batch job…";
    try {
      const response = await fetch("/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings(), diarization }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "initiate failed");
      state.preJobs = diarization
        ? { on: data, off: null }
        : { on: null, off: data };
      el("level").textContent = `job ready in ${fmtMs(data.ms)} — E2 paid`;
      log("info", "pre-initiate (E2)", { diarization, ms: data.ms });
    } catch (error) {
      el("level").textContent = `pre-initiate failed: ${error.message}`;
      log("error", "pre-initiate failed", { message: error.message });
    }
  }
}

function stopRecording() {
  if (state.hybrid) {
    if (state.hybrid.rail === "stream") void stopStreamRecording();
    else void stopHybridRecording();
    return;
  }
  if (!state.recorder || state.recorder.state === "inactive") return;
  state.recorder.stop();
  clearInterval(state.timerId);
  el("record-btn").disabled = false;
  el("record-btn").classList.remove("recording");
  el("stop-btn").disabled = true;
  state.stream?.getTracks().forEach((track) => track.stop());
}

async function handleStopped() {
  const durationSec = (Date.now() - state.startedAt) / 1000;
  const blob = new Blob(state.chunks, { type: state.mimeType });
  state.chunks = [];
  state.lastBlob = blob;
  state.lastMime = state.mimeType;
  state.lastDuration = durationSec;
  el("clip-seconds").value = durationSec.toFixed(1);
  if (!el("clip-name").value.trim()) {
    el("clip-name").value = `recording-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}`;
  }
  el("rerun-btn").disabled = false;
  log("info", "recording stopped", { seconds: Number(durationSec.toFixed(1)), bytes: blob.size });
  await runPipeline(blob, state.mimeType, durationSec);
  state.preJobs = null;
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

function settings() {
  return {
    model: el("model").value,
    mode: el("mode").value,
    language: el("language").value,
  };
}

function resolveDuration(fallback) {
  const typed = Number(el("clip-seconds").value);
  if (Number.isFinite(typed) && typed > 0) return typed;
  return fallback || null;
}

// ── hybrid rail (live preview + batch final) ─────────────────────────────────
//
// Live rail: 15–25 s PCM windows → REST endpoint (no diarization, by design).
// Final rail: the same batch job as the production path, with diarization ON.
// The live text is always provisional and is replaced by the batch transcript.

const LIVE_SAMPLE_RATE = 16000;
const MAX_PROXY_BYTES = 3_200_000;

async function proxyUpload(uploadUrl, blob, mimeType) {
  if (blob.size > MAX_PROXY_BYTES) {
    throw new Error(
      `Audio is ${(blob.size / 1024 / 1024).toFixed(1)} MB; the server proxy accepts up to 3.2 MB. ` +
        "Use compressed audio (webm/opus, mp3, m4a) or a shorter clip."
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadUrl,
      contentType: mimeType,
      audioBase64: bytesToBase64(bytes),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `upload failed (${response.status})`);
  return data;
}

function encodeWavPcm16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  new Uint8Array(out, 44).set(
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  );
  return new Uint8Array(out);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function floatToInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

async function decodeToPcm16(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const context = new Ctx();
  let decoded;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    context.close?.();
  }

  const sampleRate = LIVE_SAMPLE_RATE;
  const frames = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offline = new Offline(1, frames, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return { samples: floatToInt16(rendered.getChannelData(0)), sampleRate };
}

async function startHybridRecording() {
  state.hybridSummary = null;
  state.liveSource = "recording";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ sampleRate: LIVE_SAMPLE_RATE });
    await ctx.audioWorklet.addModule("/pcm-window-worklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-window", {
      channelCount: 1,
      processorOptions: { noiseFloorRms: 0.006 },
    });
    const sourceNode = ctx.createMediaStreamSource(stream);
    sourceNode.connect(node);
    node.connect(ctx.destination);

    state.hybrid = {
      ctx,
      node,
      source: sourceNode,
      stream,
      rail: "rest",
      windows: [],
      index: 0,
      pieces: [],
      writtenUntil: 0,
      sampleRate: LIVE_SAMPLE_RATE,
      startedAt: performance.now(),
      stoppedAt: null,
      firstTextMs: null,
      firstTextAfterStopMs: null,
      pending: 0,
      failed: 0,
      stopped: false,
      tailResolve: null,
      recorder,
      recorderMime,
      recorderChunks,
    };
    node.port.onmessage = (event) => handleWorkletMessage(event.data);

    // The live rail needs PCM; the batch rail only needs a file. Record a
    // compressed copy in parallel so long visits stay inside the proxy limit.
    let recorder = null;
    let recorderMime = "audio/webm";
    const recorderChunks = [];
    try {
      recorderMime = pickMimeType() || "audio/webm";
      recorder = new MediaRecorder(stream, { mimeType: recorderMime });
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recorderChunks.push(event.data);
      };
      recorder.start(1000);
    } catch (error) {
      log("warn", "batch recorder unavailable", { message: String(error.message).slice(0, 120) });
    }

    el("record-btn").disabled = true;
    el("record-btn").classList.add("recording");
    el("stop-btn").disabled = false;
    el("level").textContent = "hybrid: live windows + batch";
    el("live-card").hidden = false;
    renderLive();
    log("info", "hybrid recording started", { sampleRate: LIVE_SAMPLE_RATE });

    state.timerId = setInterval(() => {
      el("timer").textContent = fmtClock(Date.now() - state.hybrid.startedAt);
    }, 250);

    state.preJobs = null;
    if (el("pre-initiate").checked) {
      try {
        const response = await fetch("/api/job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...settings(), diarization: true }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "initiate failed");
        state.preJobs = { on: data, off: null };
        log("info", "pre-initiate (E2)", { diarization: true, ms: data.ms });
      } catch (error) {
        log("error", "pre-initiate failed", { message: error.message });
      }
    }
  } catch (error) {
    state.hybrid = null;
    state.liveSource = null;
    alert(`Hybrid capture unavailable: ${error.message}`);
    log("error", "hybrid capture unavailable", { message: String(error.message).slice(0, 160) });
  }
}

function handleWorkletMessage(message) {
  const hybrid = state.hybrid;
  if (!hybrid) return;

  if (message?.type === "TAIL_FLUSHED") {
    hybrid.tailResolve?.();
    return;
  }
  if (message?.type !== "PCM_WINDOW") return;

  const samples = new Int16Array(message.pcm16);
  const startSample = Math.round(message.start_s * hybrid.sampleRate);
  const skip = Math.max(
    0,
    Math.round(hybrid.writtenUntil * hybrid.sampleRate) - startSample
  );
  if (skip < samples.length) {
    hybrid.pieces.push(samples.slice(skip));
    hybrid.writtenUntil = Math.max(hybrid.writtenUntil, message.end_s);
  }

  const record = {
    index: hybrid.index++,
    start_s: message.start_s,
    end_s: message.end_s,
    cutReason: message.cutReason,
    overlap_s: message.overlap_s ?? 0,
    status: "running",
    transcript: "",
    phrases: [],
  };
  hybrid.windows.push(record);
  hybrid.pending += 1;

  const pcm = samples.slice();
  hybrid.node.port.postMessage({ type: "RECYCLE", buffer: message.pcm16 }, [message.pcm16]);
  void transcribeWindow(record, pcm, hybrid).finally(() => {
    hybrid.pending -= 1;
    if (hybrid.stopped && hybrid.pending === 0) hybrid.tailResolve?.();
  });
}

async function transcribeWindow(record, pcm16, hybrid) {
  const startedAt = performance.now();
  try {
    const wav = encodeWavPcm16(pcm16, hybrid.sampleRate);
    const response = await fetch("/api/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: bytesToBase64(wav),
        sampleRate: hybrid.sampleRate,
        model: el("model").value,
        mode: el("mode").value,
        language: el("language").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `live window failed (${response.status})`);
    record.status = "ok";
    record.transcript = data.transcript || "";
    record.phrases = zipPhrases(data.timestamps, record.start_s);
    record.ms = Math.round(performance.now() - startedAt);
    if (hybrid.firstTextMs == null && record.transcript) {
      hybrid.firstTextMs = Math.round(performance.now() - hybrid.startedAt);
      if (hybrid.stoppedAt != null) {
        hybrid.firstTextAfterStopMs = Math.round(performance.now() - hybrid.stoppedAt);
      }
    }
    log("info", "live window", {
      index: record.index,
      ms: record.ms,
      chars: record.transcript.length,
    });
  } catch (error) {
    record.status = "failed";
    record.error = error.message;
    hybrid.failed += 1;
    log("error", "live window failed", {
      index: record.index,
      message: String(error.message).slice(0, 160),
    });
  }
  renderLive();
}

function summarizeHybrid(hybrid) {
  if (hybrid.rail === "stream") {
    const finals = [...hybrid.finals].sort((a, b) => a.idx - b.idx);
    return {
      rail: "stream",
      firstTextMs: hybrid.firstTextMs,
      firstFinalMs: hybrid.firstFinalMs,
      firstTextAfterStopMs: null,
      segmentCount: finals.length,
      failedSegments: 0,
      gaps: 0,
      seamWarnings: 0,
      droppedChunks: hybrid.dropped,
      transcript: finals
        .map((item) => item.text)
        .filter(Boolean)
        .join(" ")
        .trim(),
    };
  }

  const stitched = stitchWindows(hybrid.windows);
  return {
    rail: "rest",
    firstTextMs: hybrid.firstTextMs,
    firstTextAfterStopMs: hybrid.firstTextAfterStopMs,
    firstFinalMs: null,
    segmentCount: hybrid.windows.length,
    failedSegments: hybrid.failed,
    gaps: stitched.gaps.length,
    seamWarnings: stitched.seamAudit.filter((seam) => seam.warning).length,
    transcript: stitched.fullTranscript,
  };
}

function renderLive() {
  const hybrid = state.hybrid;
  if (!hybrid) return;
  el("live-card").hidden = false;

  const box = el("live-metrics");
  box.innerHTML = "";
  const add = (text) => {
    const line = document.createElement("div");
    line.className = "metric-line";
    line.textContent = text;
    box.appendChild(line);
  };

  if (hybrid.rail === "stream") {
    const text =
      [...hybrid.finals]
        .sort((a, b) => a.idx - b.idx)
        .map((item) => item.text)
        .filter(Boolean)
        .join(" ") + (hybrid.partial ? ` ${hybrid.partial}` : "");
    el("live-transcript").textContent = text.trim() || "(waiting for the first partial…)";
    add(
      `utterances ${hybrid.finals.length} · ` +
        (hybrid.firstTextMs != null
          ? `first partial ${(hybrid.firstTextMs / 1000).toFixed(1)} s`
          : "first partial: waiting") +
        (hybrid.firstFinalMs != null
          ? ` · first final ${(hybrid.firstFinalMs / 1000).toFixed(1)} s`
          : "") +
        (hybrid.dropped ? ` · dropped chunks ${hybrid.dropped}` : "")
    );
    return;
  }

  const stitched = stitchWindows(hybrid.windows);
  el("live-transcript").textContent =
    stitched.fullTranscript || "(waiting for the first window…)";
  add(
    `windows ${hybrid.windows.length} · pending ${hybrid.pending} · failed ${hybrid.failed}` +
      (hybrid.firstTextMs != null
        ? ` · first text ${(hybrid.firstTextMs / 1000).toFixed(1)} s after start`
        : " · first text: waiting")
  );
  if (stitched.gaps.length) {
    add(`${stitched.gaps.length} gap(s): a failed window is a hole, never silently missing text.`);
  }
}

async function stopHybridRecording() {
  const hybrid = state.hybrid;
  if (!hybrid) return;

  hybrid.stoppedAt = performance.now();
  hybrid.stopped = true;
  clearInterval(state.timerId);
  el("record-btn").disabled = false;
  el("record-btn").classList.remove("recording");
  el("stop-btn").disabled = true;
  el("level").textContent = "flushing live windows…";

  await new Promise((resolve) => {
    hybrid.tailResolve = resolve;
    hybrid.node.port.postMessage({ type: "FLUSH_TAIL" });
    setTimeout(resolve, 6000);
  });

  const deadline = Date.now() + 45_000;
  while (hybrid.pending > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  hybrid.node.port.onmessage = null;
  let batchBlob = null;
  if (hybrid.recorder && hybrid.recorder.state !== "inactive") {
    batchBlob = await new Promise((resolve) => {
      const finish = () =>
        resolve(new Blob(hybrid.recorderChunks, { type: hybrid.recorderMime }));
      hybrid.recorder.onstop = finish;
      try {
        hybrid.recorder.stop();
      } catch {
        finish();
      }
      setTimeout(finish, 2500);
    });
  }

  try {
    await hybrid.ctx.close();
  } catch {
    /* already closed */
  }
  hybrid.stream.getTracks().forEach((track) => track.stop());

  const totalSamples = hybrid.pieces.reduce((sum, piece) => sum + piece.length, 0);
  const samples = new Int16Array(totalSamples);
  let offset = 0;
  for (const piece of hybrid.pieces) {
    samples.set(piece, offset);
    offset += piece.length;
  }
  const durationSec = samples.length / hybrid.sampleRate;
  const wav = encodeWavPcm16(samples, hybrid.sampleRate);

  state.hybridSummary = summarizeHybrid(hybrid);
  renderLive();
  state.hybrid = null;

  if (!batchBlob || batchBlob.size === 0) {
    batchBlob = new Blob([wav], { type: "audio/wav" });
    hybrid.recorderMime = "audio/wav";
  }

  state.lastBlob = batchBlob;
  state.lastMime = hybrid.recorderMime;
  state.lastDuration = durationSec;
  el("clip-seconds").value = durationSec.toFixed(1);
  if (!el("clip-name").value.trim()) {
    el("clip-name").value = `recording-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}`;
  }
  el("rerun-btn").disabled = false;
  log("info", "hybrid recording stopped", {
    seconds: Number(durationSec.toFixed(1)),
    bytes: batchBlob.size,
    windows: state.hybridSummary.segmentCount,
  });

  await runPipeline(state.lastBlob, state.lastMime, durationSec);
}

/** File variant: same two rails, driven from a decoded file instead of mic input. */
async function runFileHybrid(file) {
  const hybrid = {
    windows: [],
    index: 0,
    rail: "rest",
    sampleRate: LIVE_SAMPLE_RATE,
    startedAt: performance.now(),
    stoppedAt: performance.now(),
    firstTextMs: null,
    firstTextAfterStopMs: null,
    pending: 0,
    failed: 0,
    stopped: true,
  };
  state.hybrid = hybrid;
  el("live-card").hidden = false;
  renderLive();

  try {
    const { samples, sampleRate } = await decodeToPcm16(file);
    hybrid.sampleRate = sampleRate;
    const windowSamples = 25 * sampleRate;
    const overlapSamples = Math.round(1.75 * sampleRate);
    let start = 0;

    while (start < samples.length) {
      const hardCap = start + windowSamples < samples.length;
      const end = Math.min(start + windowSamples, samples.length);
      const record = {
        index: hybrid.index++,
        start_s: start / sampleRate,
        end_s: end / sampleRate,
        cutReason: hardCap ? "hard-cap" : "stop-tail",
        overlap_s: hardCap ? 1.75 : 0,
        status: "running",
        transcript: "",
        phrases: [],
      };
      hybrid.windows.push(record);
      await transcribeWindow(record, samples.slice(start, end), hybrid);
      start = hardCap ? end - overlapSamples : end;
    }
  } catch (error) {
    log("error", "file hybrid failed", { message: String(error.message).slice(0, 160) });
  } finally {
    state.hybridSummary = summarizeHybrid(hybrid);
    state.hybrid = hybrid;
    renderLive();
    state.hybrid = null;
  }
}

function renderHybridComparison(record) {
  const summary = state.hybridSummary;
  el("ab-card").hidden = false;
  const body = document.querySelector("#ab-table tbody");
  body.innerHTML = "";

  const isStream = summary?.rail === "stream";
  const rows = isStream
    ? [
        ["first partial", summary?.firstTextMs != null ? fmtMs(summary.firstTextMs) : "—"],
        ["first final", summary?.firstFinalMs != null ? fmtMs(summary.firstFinalMs) : "—"],
        ["utterances", summary?.segmentCount ?? "—"],
        ["dropped chunks", summary?.droppedChunks ?? "—"],
        ["t_final (batch)", "—", fmtMs(record.totalMs)],
        ["provider wait", "—", fmtMs(record.providerWaitMs)],
        ["speaker turns", "none available", record.turnCount ?? 0],
        ["ratio ×", "—", record.ratio ?? "—"],
      ]
    : [
        ["first text (from start)", summary?.firstTextMs != null ? fmtMs(summary.firstTextMs) : "—"],
        ["first text after stop", summary?.firstTextAfterStopMs != null ? fmtMs(summary.firstTextAfterStopMs) : "0 ms"],
        ["live windows", summary?.segmentCount ?? "—"],
        ["failed windows", summary?.failedSegments ?? "—"],
        ["gaps", summary?.gaps ?? "—"],
        ["t_final (batch)", "—", fmtMs(record.totalMs)],
        ["provider wait", "—", fmtMs(record.providerWaitMs)],
        ["speaker turns", "none available", record.turnCount ?? 0],
        ["ratio ×", "—", record.ratio ?? "—"],
      ];

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(row[0])}</td><td>${escapeHtml(String(row[1] ?? "—"))}</td><td>${escapeHtml(
      String(row[2] ?? "—")
    )}</td><td>—</td>`;
    body.appendChild(tr);
  }

  const notes = el("ab-summary");
  notes.innerHTML = "";
  const add = (text) => {
    const line = document.createElement("div");
    line.className = "note";
    line.textContent = text;
    notes.appendChild(line);
  };
  if (summary?.firstTextMs != null) {
    add(
      `Provisional text appeared after ${fmtMs(summary.firstTextMs)}` +
        (summary.firstTextAfterStopMs != null
          ? ` (${fmtMs(summary.firstTextAfterStopMs)} after stop)`
          : " (while still recording)") +
        `; the authoritative diarized transcript took ${fmtMs(record.totalMs)}.`
    );
  } else {
    add("No live text was produced — check the live errors in the event log.");
  }
  add(
    `Rail: ${isStream ? "realtime WebSocket (partials, no speakers)" : "REST chunks (no speakers)"}. ` +
      "Provisional text is unconfirmed and is replaced by the batch transcript. Audio was transcribed twice, so this run costs REST/stream + batch."
  );

  const box = el("ab-transcripts");
  box.innerHTML = "";
  for (const [name, text] of [
    [`live preview (${isStream ? "stream" : "REST chunks"})`, summary?.transcript || "(no live text)"],
    ["batch (authoritative, diarized)", record.transcript || "(no transcript)"],
  ]) {
    const heading = document.createElement("div");
    heading.className = "note";
    heading.textContent = name;
    box.appendChild(heading);
    const transcript = document.createElement("div");
    transcript.className = "transcript";
    transcript.textContent = text;
    box.appendChild(transcript);
  }
}

// ── streaming live rail (realtime WebSocket) ────────────────────────────────
//
// Throwaway tester only: the Sarvam key is passed in the WebSocket subprotocol,
// which makes it visible in devtools. Do not copy this into a product build.

function realtimeUrl() {
  const language = el("language").value === "unknown" ? "auto" : el("language").value;
  const params = new URLSearchParams({
    language_code: language,
    model: state.realtimeModel || "saaras:v3-realtime",
    mode: el("mode").value,
    encoding: "linear16",
    sample_rate: "16000",
    endpointing: "vad",
    return_timestamps: "true",
  });
  return `wss://api.sarvam.ai/speech-to-text-realtime/ws?${params}`;
}

function openRealtimeSocket(hybrid) {
  if (!state.realtimeKey) throw new Error("Realtime key is not configured.");
  const ws = new WebSocket(realtimeUrl(), [`api-subscription-key.${state.realtimeKey}`]);
  hybrid.ws = ws;

  hybrid.ready = new Promise((resolve, reject) => {
    hybrid.resolveReady = resolve;
    hybrid.rejectReady = reject;
    setTimeout(() => reject(new Error("realtime session did not start within 10 s")), 10_000);
  });

  ws.onmessage = (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleRealtimeMessage(hybrid, message);
  };
  ws.onerror = () => log("error", "realtime socket error", {});
  ws.onclose = (event) => {
    hybrid.resolveEnd?.();
    log(event.wasClean ? "info" : "warn", "realtime socket closed", {
      code: event.code,
      reason: String(event.reason || "").slice(0, 80),
    });
  };
  return ws;
}

function handleRealtimeMessage(hybrid, message) {
  switch (message.event) {
    case "session.begin":
      hybrid.resolveReady?.();
      for (const buffer of hybrid.queued.splice(0)) sendPcm(hybrid, buffer);
      log("info", "realtime session ready", {
        model: message.config?.model,
        rate: message.config?.sample_rate,
      });
      break;

    case "transcript.partial":
      hybrid.partial = message.text || "";
      if (hybrid.firstTextMs == null) {
        hybrid.firstTextMs = Math.round(performance.now() - hybrid.startedAt);
      }
      renderLive();
      break;

    case "transcript.final":
      hybrid.finals.push({
        idx: Number.isFinite(message.utterance_idx) ? message.utterance_idx : hybrid.finals.length,
        text: message.text || "",
      });
      hybrid.partial = "";
      if (hybrid.firstFinalMs == null) {
        hybrid.firstFinalMs = Math.round(performance.now() - hybrid.startedAt);
      }
      renderLive();
      break;

    case "session.end":
      hybrid.resolveEnd?.();
      break;

    case "error":
      log("error", "realtime error", {
        code: message.code,
        fatal: Boolean(message.is_fatal),
      });
      if (message.is_fatal) hybrid.rejectReady?.(new Error(message.message || message.code));
      break;

    default:
      break;
  }
}

function sendPcm(hybrid, buffer) {
  const ws = hybrid.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (hybrid.queued.length < 200) hybrid.queued.push(buffer);
    else hybrid.dropped += 1;
    return;
  }
  if (ws.bufferedAmount > 1_000_000) {
    hybrid.dropped += 1;
    return;
  }
  ws.send(
    JSON.stringify({
      event: "audio_input",
      audio: bytesToBase64(new Uint8Array(buffer)),
    })
  );
}

async function startStreamRecording() {
  state.hybridSummary = null;
  state.liveSource = "recording";

  if (!state.realtimeKey) {
    alert("Realtime streaming needs SARVAM_API_KEY exposed by /api/config.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ sampleRate: LIVE_SAMPLE_RATE });
    await ctx.audioWorklet.addModule("/pcm-stream-worklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-stream", {
      channelCount: 1,
      processorOptions: { chunkMs: 100 },
    });
    const sourceNode = ctx.createMediaStreamSource(stream);
    sourceNode.connect(node);
    node.connect(ctx.destination);

    let recorder = null;
    let recorderMime = "audio/webm";
    const recorderChunks = [];
    try {
      recorderMime = pickMimeType() || "audio/webm";
      recorder = new MediaRecorder(stream, { mimeType: recorderMime });
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recorderChunks.push(event.data);
      };
      recorder.start(1000);
    } catch (error) {
      log("warn", "batch recorder unavailable", {
        message: String(error.message).slice(0, 120),
      });
    }

    const hybrid = {
      rail: "stream",
      ws: null,
      ctx,
      node,
      source: sourceNode,
      stream,
      finals: [],
      partial: "",
      queued: [],
      dropped: 0,
      startedAt: performance.now(),
      stoppedAt: null,
      firstTextMs: null,
      firstFinalMs: null,
      resolveReady: null,
      rejectReady: null,
      resolveEnd: null,
      recorder,
      recorderMime,
      recorderChunks,
      stopResolve: null,
    };
    state.hybrid = hybrid;

    node.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "PCM_CHUNK") sendPcm(hybrid, message.pcm16);
      else if (message?.type === "STOPPED") hybrid.stopResolve?.();
    };

    openRealtimeSocket(hybrid);

    el("record-btn").disabled = true;
    el("record-btn").classList.add("recording");
    el("stop-btn").disabled = false;
    el("level").textContent = "streaming: realtime + batch";
    el("live-card").hidden = false;
    renderLive();
    log("info", "streaming recording started", { model: state.realtimeModel });

    state.timerId = setInterval(() => {
      el("timer").textContent = fmtClock(Date.now() - state.hybrid.startedAt);
    }, 250);

    state.preJobs = null;
    if (el("pre-initiate").checked) {
      try {
        const response = await fetch("/api/job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...settings(), diarization: true }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "initiate failed");
        state.preJobs = { on: data, off: null };
        log("info", "pre-initiate (E2)", { diarization: true, ms: data.ms });
      } catch (error) {
        log("error", "pre-initiate failed", { message: error.message });
      }
    }
  } catch (error) {
    state.hybrid = null;
    state.liveSource = null;
    alert(`Streaming capture unavailable: ${error.message}`);
    log("error", "streaming capture unavailable", {
      message: String(error.message).slice(0, 160),
    });
  }
}

async function stopStreamRecording() {
  const hybrid = state.hybrid;
  if (!hybrid) return;

  hybrid.stoppedAt = performance.now();
  clearInterval(state.timerId);
  el("record-btn").disabled = false;
  el("record-btn").classList.remove("recording");
  el("stop-btn").disabled = true;
  el("level").textContent = "closing the stream…";

  await new Promise((resolve) => {
    hybrid.stopResolve = resolve;
    hybrid.node.port.postMessage({ type: "STOP" });
    setTimeout(resolve, 2000);
  });

  if (hybrid.ws?.readyState === WebSocket.OPEN) {
    try {
      hybrid.ws.send(JSON.stringify({ event: "end" }));
    } catch {
      /* socket already closing */
    }
  }
  await new Promise((resolve) => {
    hybrid.resolveEnd = resolve;
    setTimeout(resolve, 3000);
  });
  try {
    hybrid.ws?.close();
  } catch {
    /* already closed */
  }

  let batchBlob = null;
  if (hybrid.recorder && hybrid.recorder.state !== "inactive") {
    batchBlob = await new Promise((resolve) => {
      const finish = () => resolve(new Blob(hybrid.recorderChunks, { type: hybrid.recorderMime }));
      hybrid.recorder.onstop = finish;
      try {
        hybrid.recorder.stop();
      } catch {
        finish();
      }
      setTimeout(finish, 2500);
    });
  }

  try {
    await hybrid.ctx.close();
  } catch {
    /* already closed */
  }
  hybrid.stream.getTracks().forEach((track) => track.stop());

  state.hybridSummary = summarizeHybrid(hybrid);
  renderLive();
  state.hybrid = null;

  if (!batchBlob || batchBlob.size === 0) {
    alert("The batch rail needs a MediaRecorder copy; this browser did not produce one.");
    return;
  }

  state.lastBlob = batchBlob;
  state.lastMime = hybrid.recorderMime;
  state.lastDuration = hybrid.stoppedAt / 1000 - hybrid.startedAt / 1000;
  el("clip-seconds").value = state.lastDuration.toFixed(1);
  if (!el("clip-name").value.trim()) {
    el("clip-name").value = `recording-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}`;
  }
  el("rerun-btn").disabled = false;
  log("info", "streaming recording stopped", {
    seconds: Number(state.lastDuration.toFixed(1)),
    bytes: batchBlob.size,
    utterances: state.hybridSummary.segmentCount,
  });

  await runPipeline(state.lastBlob, state.lastMime, state.lastDuration);
}

/** File replay for the streaming rail: send PCM as fast as the socket allows. */
async function runFileStream(file) {
  const hybrid = {
    rail: "stream",
    ws: null,
    finals: [],
    partial: "",
    queued: [],
    dropped: 0,
    startedAt: performance.now(),
    stoppedAt: performance.now(),
    firstTextMs: null,
    firstFinalMs: null,
    resolveReady: null,
    rejectReady: null,
    resolveEnd: null,
  };
  state.hybrid = hybrid;
  el("live-card").hidden = false;
  renderLive();

  try {
    const { samples } = await decodeToPcm16(file);
    openRealtimeSocket(hybrid);
    await hybrid.ready;

    const chunkSamples = 1600; // 100 ms @ 16 kHz
    for (let start = 0; start < samples.length; start += chunkSamples) {
      const slice = samples.slice(start, Math.min(start + chunkSamples, samples.length));
      sendPcm(hybrid, slice.buffer);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await new Promise((resolve) => {
      hybrid.resolveEnd = resolve;
      setTimeout(resolve, 8000);
      try {
        hybrid.ws?.send(JSON.stringify({ event: "end" }));
      } catch {
        resolve();
      }
    });
  } catch (error) {
    log("error", "stream file replay failed", {
      message: String(error.message).slice(0, 160),
    });
  } finally {
    try {
      hybrid.ws?.close();
    } catch {
      /* already closed */
    }
    state.hybridSummary = summarizeHybrid(hybrid);
    renderLive();
    state.hybrid = null;
  }
}

// ── shared status budget ─────────────────────────────────────────────────────

let lastStatusCallAt = 0;

/** Serialises status calls across concurrent runs so two A/B jobs cannot exceed 20/min. */
async function statusGate() {
  const wait = lastStatusCallAt + STATUS_MIN_GAP_MS - performance.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastStatusCallAt = performance.now();
}

// ── run card ─────────────────────────────────────────────────────────────────

function createCard(host, title) {
  const article = document.createElement("article");
  article.className = "run";
  article.innerHTML = `
    <div class="run-head">
      <span class="run-title"></span>
      <span class="run-total chip">running…</span>
    </div>
    <div class="steps"></div>
    <div class="notes"></div>
    <div class="result"></div>`;
  article.querySelector(".run-title").textContent = title;
  host.appendChild(article);
  return {
    article,
    total: article.querySelector(".run-total"),
    steps: article.querySelector(".steps"),
    notes: article.querySelector(".notes"),
    result: article.querySelector(".result"),
  };
}

function addStep(card, record, name, ok, durationMs, detail) {
  const row = document.createElement("div");
  row.className = `step ${ok ? "" : "failed"}`;
  row.innerHTML = `<span class="name">${escapeHtml(name)}</span><span class="ms">${fmtMs(
    durationMs
  )}</span><span class="detail">${escapeHtml(detail ?? "")}</span>`;
  card.steps.appendChild(row);
  record.steps.push({ name, ok, ms: durationMs ?? null, at: new Date().toISOString(), detail: detail ?? null });
}

function note(card, text, bad = false) {
  const line = document.createElement("div");
  line.className = "note";
  if (bad) line.style.color = "var(--bad)";
  line.textContent = text;
  card.notes.appendChild(line);
}

async function jsonStep(card, record, name, url, options) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  const ms = Math.round(performance.now() - startedAt);
  addStep(card, record, name, response.ok, data.ms ?? ms, data.error ?? "");
  if (response.ok) log("info", name, { variant: record.variant, ms: data.ms ?? ms });
  else log("error", name, { variant: record.variant, status: response.status, message: String(data.error || "").slice(0, 160) });
  if (!response.ok) throw new Error(data.error || `${name} failed (${response.status})`);
  return data;
}

// ── one variant ──────────────────────────────────────────────────────────────

async function runVariant({ blob, mimeType, durationSec, diarization, variant, card, reuseJob }) {
  const startedAt = performance.now();
  const record = {
    at: new Date().toISOString(),
    label: el("label").value.trim(),
    variant,
    diarization,
    durationSec: resolveDuration(durationSec),
    audioBytes: blob.size,
    mimeType,
    model: el("model").value,
    mode: el("mode").value,
    preInitiated: Boolean(reuseJob),
    clipId: state.activeClip?.id ?? null,
    clipName: state.activeClip?.name ?? null,
    runMode: runMode(),
    status: "running",
    totalMs: null,
    providerWaitMs: null,
    probeCount: null,
    jobId: null,
    steps: [],
  };

  log("info", "run started", {
    variant,
    bytes: blob.size,
    seconds: record.durationSec ?? "?",
    model: record.model,
  });

  try {
    let jobId;
    if (reuseJob) {
      jobId = reuseJob.jobId;
      addStep(card, record, "batch.initiate", true, 0, "pre-initiated during recording (E2)");
    } else {
      const job = await jsonStep(card, record, "batch.initiate", "/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: record.model,
          mode: record.mode,
          language: el("language").value,
          diarization,
        }),
      });
      jobId = job.jobId;
    }
    record.jobId = jobId;

    const fileName = `part-1.${extForMime(mimeType)}`;
    const presign = await jsonStep(card, record, "batch.upload_url", "/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, files: [fileName] }),
    });
    const uploadUrl = presign.files[fileName];
    if (!uploadUrl) throw new Error("No presigned upload URL returned.");

    const putStartedAt = performance.now();
    try {
      const result = await proxyUpload(uploadUrl, blob, mimeType);
      const putMs = Math.round(performance.now() - putStartedAt);
      addStep(
        card,
        record,
        "batch.upload_put",
        true,
        putMs,
        `${fmtKb(blob.size)} · via server proxy`
      );
      log("info", "batch.upload_put", {
        variant,
        ms: putMs,
        bytes: blob.size,
        via: "server-proxy",
        status: result.status,
      });
    } catch (error) {
      const putMs = Math.round(performance.now() - putStartedAt);
      addStep(card, record, "batch.upload_put", false, putMs, "proxy upload failed");
      log("error", "upload failed", {
        variant,
        ms: putMs,
        message: String(error.message).slice(0, 160),
      });
      throw new Error(`Upload failed: ${error.message}`);
    }

    await jsonStep(card, record, "batch.start", "/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    const pollMs = Math.max(1000, Number(el("poll-ms").value) || 3000);
    const deadline = Date.now() + 15 * 60 * 1000;
    const waitStartedAt = performance.now();
    let probes = 0;
    let status;
    for (;;) {
      await statusGate();
      status = await jsonStep(card, record, `batch.status#${++probes}`, `/api/status?jobId=${encodeURIComponent(jobId)}`, {
        method: "GET",
      });
      if (status.jobState === "Completed") break;
      if (status.jobState === "Failed") {
        const failure = status.failures?.[0];
        throw new Error(`Sarvam job failed: ${failure?.errorMessage ?? status.errorMessage ?? "unknown"}`);
      }
      if (Date.now() > deadline) throw new Error(`Still ${status.jobState} after 15 minutes.`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    record.providerWaitMs = Math.round(performance.now() - waitStartedAt);
    record.probeCount = probes;
    note(card, `Provider wait: ${(record.providerWaitMs / 1000).toFixed(1)} s over ${probes} probe(s).`);
    log("info", "job completed", { variant, providerWaitMs: record.providerWaitMs, probes });

    const result = await jsonStep(card, record, "batch.download", "/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, files: status.outputFiles }),
    });

    record.transcript = result.transcript || "";
    record.turns = result.turns || [];
    record.transcriptChars = record.transcript.length;
    record.turnCount = record.turns.length;
    record.languageCode = result.languageCode ?? null;

    if (record.turns.length) {
      const box = document.createElement("div");
      box.className = "turns";
      for (const turn of record.turns) {
        const row = document.createElement("div");
        row.className = "turn";
        const time =
          turn.startTimeSeconds == null
            ? ""
            : `${Number(turn.startTimeSeconds).toFixed(1)}→${Number(turn.endTimeSeconds ?? 0).toFixed(1)}`;
        row.innerHTML = `<span class="who">S${escapeHtml(turn.speakerId)}</span><span class="time">${time}</span><span>${escapeHtml(turn.transcript)}</span>`;
        box.appendChild(row);
      }
      card.result.appendChild(box);
    }
    const text = document.createElement("div");
    text.className = "transcript";
    text.textContent = record.transcript || "(empty transcript)";
    card.result.appendChild(text);

    record.status = "completed";
    log("info", "run completed", {
      variant,
      chars: record.transcriptChars,
      turns: record.turnCount,
      language: record.languageCode ?? "?",
    });
    return record;
  } catch (error) {
    record.status = "failed";
    record.error = error.message;
    log("error", "run failed", { variant, message: String(error.message).slice(0, 200) });
    note(card, error.message, true);
    return record;
  } finally {
    record.totalMs = Math.round(performance.now() - startedAt);
    record.ratio =
      record.durationSec && record.totalMs
        ? Number((record.totalMs / 1000 / record.durationSec).toFixed(2))
        : null;
    record.overheadMs =
      record.providerWaitMs != null ? Math.max(0, record.totalMs - record.providerWaitMs) : null;

    if (record.status === "completed" && state.hybridSummary) {
      Object.assign(record, {
        firstTextMs: state.hybridSummary.firstTextMs,
        firstTextAfterStopMs: state.hybridSummary.firstTextAfterStopMs,
        firstFinalMs: state.hybridSummary.firstFinalMs,
        rail: state.hybridSummary.rail,
        segmentCount: state.hybridSummary.segmentCount,
        failedSegments: state.hybridSummary.failedSegments,
        gaps: state.hybridSummary.gaps,
        seamWarnings: state.hybridSummary.seamWarnings,
      });
    }

    log("info", "run summary", {
      mode: record.runMode,
      sec: record.durationSec != null ? Number(record.durationSec.toFixed(1)) : "?",
      total: fmtMs(record.totalMs),
      ratio: record.ratio ?? "?",
      provider: fmtMs(record.providerWaitMs),
      overhead: fmtMs(record.overheadMs),
      first: record.firstTextMs != null ? fmtMs(record.firstTextMs) : "—",
      turns: record.turnCount ?? 0,
      status: record.status,
    });

    if (record.status === "completed") {
      card.total.textContent = `${fmtMs(record.totalMs)}${record.ratio ? ` · ×${record.ratio}` : ""}`;
    } else {
      card.total.textContent = "failed";
      card.total.classList.add("bad");
    }

    saveRun(record);
    renderHistory();
    renderBenchmarks();
  }
}

// ── pipeline (one mode per run) ─────────────────────────────────────────────

async function runPipeline(blob, mimeType, durationSec) {
  if (state.busy) return;
  state.busy = true;

  const host = el("run-panel");
  host.innerHTML = "";
  const label =
    el("label").value.trim() ||
    state.activeClip?.name ||
    el("clip-name").value.trim() ||
    state.lastFileName ||
    "run";
  if (!el("label").value.trim()) el("label").value = label;
  const mode = runMode();
  const diarization = diarizationForMode(mode);

  try {
    if (!mode.startsWith("hybrid")) {
      state.hybridSummary = null;
      el("live-card").hidden = true;
    }
    if (mode.startsWith("hybrid")) {
      el("ab-card").hidden = true;
      el("ab-summary").innerHTML = "";
      document.querySelector("#ab-table tbody").innerHTML = "";
      el("ab-transcripts").innerHTML = "";
    }

    let livePromise = Promise.resolve();
    if (state.liveSource === "file") {
      if (mode === "hybrid-rest") livePromise = runFileHybrid(blob);
      else if (mode === "hybrid-stream") livePromise = runFileStream(blob);
    }

    const card = createCard(
      host,
      `${label || "run"} — ${mode.startsWith("hybrid") ? "batch rail, " : ""}diarization ${
        diarization ? "ON" : "OFF"
      }`
    );

    const [record] = await Promise.all([
      runVariant({
        blob,
        mimeType,
        durationSec,
        diarization,
        variant: diarization ? "diar-on" : "diar-off",
        card,
        reuseJob: diarization ? state.preJobs?.on : state.preJobs?.off,
      }),
      livePromise,
    ]);

    state.preJobs = null;
    if (mode.startsWith("hybrid")) renderHybridComparison(record);
  } finally {
    state.busy = false;
    state.liveSource = null;
  }
}

function renderComparison(on, off) {
  const body = document.querySelector("#ab-table tbody");
  body.innerHTML = "";
  const summary = el("ab-summary");
  summary.innerHTML = "";

  const delta = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
    const diff = a - b;
    const sign = diff > 0 ? "+" : "";
    return `${sign}${Math.abs(diff) < 1000 ? `${Math.round(diff)} ms` : `${(diff / 1000).toFixed(2)} s`}`;
  };

  const rows = [
    ["status", on.status, off.status, deltaText(on.status, off.status)],
    ["total", fmtMs(on.totalMs), fmtMs(off.totalMs), delta(on.totalMs, off.totalMs)],
    ["provider wait", fmtMs(on.providerWaitMs), fmtMs(off.providerWaitMs), delta(on.providerWaitMs, off.providerWaitMs)],
    ["our overhead", fmtMs(on.overheadMs), fmtMs(off.overheadMs), delta(on.overheadMs, off.overheadMs)],
    ["status probes", on.probeCount ?? "—", off.probeCount ?? "—", "—"],
    ["transcript chars", on.transcriptChars ?? "—", off.transcriptChars ?? "—", delta(on.transcriptChars, off.transcriptChars)],
    ["speaker turns", on.turnCount ?? 0, off.turnCount ?? 0, delta(on.turnCount, off.turnCount)],
    ["ratio ×", on.ratio ?? "—", off.ratio ?? "—", "—"],
  ];

  for (const [name, a, b, d] of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${a}</td><td>${b}</td><td>${d}</td>`;
    body.appendChild(tr);
  }

  const add = (text) => {
    const line = document.createElement("div");
    line.className = "note";
    line.textContent = text;
    summary.appendChild(line);
  };
  if (on.status === "completed" && off.status === "completed") {
    const providerDelta = on.providerWaitMs - off.providerWaitMs;
    add(
      `Diarization cost on this clip: ${delta(on.totalMs, off.totalMs)} end-to-end, ` +
        `${providerDelta >= 0 ? "+" : ""}${(providerDelta / 1000).toFixed(1)} s of it Sarvam's own work.`
    );
    add("Both jobs were polled on the same global 20 req/min budget, so detection lag is symmetric.");
  } else {
    add("Comparison incomplete — see the per-step breakdown above.");
  }

  add(
    "Concurrent: both jobs were submitted at the same moment, so Sarvam queue drift is shared."
  );
  const box = el("ab-transcripts");
  for (const [name, record] of [
    ["diarization ON", on],
    ["diarization OFF", off],
  ]) {
    const heading = document.createElement("div");
    heading.className = "note";
    heading.textContent = name;
    box.appendChild(heading);
    const text = document.createElement("div");
    text.className = "transcript";
    text.textContent = record.transcript || "(no transcript)";
    box.appendChild(text);
  }
}

function deltaText(a, b) {
  if (a === b) return "same";
  return `${a} / ${b}`;
}

// ── storage ──────────────────────────────────────────────────────────────────

function loadRuns() {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]");
  } catch {
    return [];
  }
}

/** Persists the summary only — `transcript` and `turns` are deliberately dropped. */
function saveRun(record) {
  const { transcript, turns, ...safe } = record;
  const runs = loadRuns();
  runs.unshift(safe);
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, 200)));
  void shareRun(safe);
}

// ── history ──────────────────────────────────────────────────────────────────

function modeLabel(mode) {
  return (
    {
      "batch-on": "batch · DIA ON",
      "batch-off": "batch · DIA OFF",
      "hybrid-rest": "hybrid · REST",
      "hybrid-stream": "hybrid · stream",
      hybrid: "hybrid · REST",
    }[mode] || mode || "batch"
  );
}

function renderHistory() {
  const body = document.querySelector("#history tbody");
  body.innerHTML = "";
  for (const run of loadRuns()) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(run.at).toLocaleTimeString()}</td>
      <td>${escapeHtml(modeLabel(run.runMode || (run.diarization ? "batch-on" : "batch-off")))}</td>
      <td>${escapeHtml(run.clipName || run.label || "—")}</td>
      <td>${fmtSec(run.durationSec)}</td>
      <td>${run.ratio ?? "—"}</td>
      <td>${fmtMs(run.totalMs)}</td>
      <td>${run.firstTextMs != null ? fmtMs(run.firstTextMs) : "—"}</td>
      <td>${fmtMs(run.providerWaitMs)}</td>
      <td>${run.turnCount ?? 0}</td>
      <td class="${run.status === "completed" ? "" : "bad"}">${run.status}</td>`;

    const detail = document.createElement("tr");
    detail.hidden = true;
    const cells = (run.steps || [])
      .map(
        (step) =>
          `<div class="step ${step.ok ? "" : "failed"}"><span class="name">${escapeHtml(
            step.name
          )}</span><span class="ms">${fmtMs(step.ms)}</span><span class="detail">${escapeHtml(
            step.detail ?? ""
          )}</span></div>`
      )
      .join("");
    detail.innerHTML = `<td colspan="10">${
      cells || '<span class="muted small">no steps recorded</span>'
    }${run.error ? `<div class="note" style="color:var(--bad)">${escapeHtml(run.error)}</div>` : ""}</td>`;

    row.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
    });
    body.appendChild(row);
    body.appendChild(detail);
  }
}

// ── benchmarks ───────────────────────────────────────────────────────────────

const BUCKETS = [
  { label: "< 30 s", test: (d) => d < 30 },
  { label: "30–60 s", test: (d) => d >= 30 && d < 60 },
  { label: "1–3 min", test: (d) => d >= 60 && d < 180 },
  { label: "3–10 min", test: (d) => d >= 180 && d < 600 },
  { label: "≥ 10 min", test: (d) => d >= 600 },
];

const MODES = ["batch-on", "batch-off", "hybrid-rest", "hybrid-stream"];

function modeOf(run) {
  const mode = run.runMode || (run.diarization ? "batch-on" : "batch-off");
  return mode === "hybrid" ? "hybrid-rest" : mode;
}

function renderBenchmarks() {
  const all = loadRuns();
  const runs = all.filter((run) => run.status === "completed");
  const body = document.querySelector("#benchmarks tbody");
  const summary = el("bench-summary");
  body.innerHTML = "";
  summary.innerHTML = "";

  const add = (text) => {
    const line = document.createElement("div");
    line.className = "note";
    line.textContent = text;
    summary.appendChild(line);
  };

  if (runs.length === 0) {
    add("No completed runs yet — record audio or run a saved clip.");
    return;
  }

  const groups = [];
  for (const mode of MODES) {
    const modeRuns = runs.filter((run) => modeOf(run) === mode);
    if (modeRuns.length === 0) continue;
    for (const bucket of BUCKETS) {
      const group = modeRuns.filter(
        (run) => Number.isFinite(run.durationSec) && bucket.test(run.durationSec)
      );
      if (group.length) groups.push({ mode, label: bucket.label, runs: group });
    }
    const unknown = modeRuns.filter((run) => !Number.isFinite(run.durationSec));
    if (unknown.length) groups.push({ mode, label: "unknown", runs: unknown });
  }

  for (const group of groups) {
    const turnsOk = group.runs.filter((run) => Number(run.turnCount) > 0).length;
    const firstTexts = group.runs.map((run) => run.firstTextMs).filter(Number.isFinite);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(modeLabel(group.mode))}</td>
      <td>${escapeHtml(group.label)}</td>
      <td>${group.runs.length}</td>
      <td>${median(group.runs.map((run) => run.ratio)) ?? "—"}</td>
      <td>${fmtMs(median(group.runs.map((run) => run.totalMs)))}</td>
      <td>${fmtMs(median(group.runs.map((run) => run.providerWaitMs)))}</td>
      <td>${fmtMs(median(group.runs.map((run) => run.overheadMs)))}</td>
      <td>${firstTexts.length ? fmtMs(median(firstTexts)) : "—"}</td>
      <td>${turnsOk}/${group.runs.length}</td>`;
    body.appendChild(row);
  }

  add(`${runs.length} completed run(s). Failed runs are excluded from every median.`);

  // The number the hybrid decision actually turns on: how much earlier does the
  // doctor see text on the same length bucket?
  for (const bucket of BUCKETS) {
    const inBucket = (mode) =>
      runs.filter(
        (run) =>
          modeOf(run) === mode &&
          Number.isFinite(run.durationSec) &&
          bucket.test(run.durationSec)
      );

    const baseline = inBucket("batch-on");
    if (baseline.length === 0) continue;
    const batchTotal = median(baseline.map((run) => run.totalMs));

    for (const hybridMode of ["hybrid-stream", "hybrid-rest"]) {
      const live = inBucket(hybridMode);
      if (live.length === 0) continue;
      const first = median(live.map((run) => run.firstTextMs).filter(Number.isFinite));
      if (first == null) continue;
      add(
        `${bucket.label} · ${modeLabel(hybridMode)}: first text at ${fmtMs(first)} vs ` +
          `${fmtMs(batchTotal)} for batch ON → ${fmtMs(Math.max(0, batchTotal - first))} earlier.`
      );
    }
  }

  const perMode = MODES.map((mode) => {
    const list = runs.filter((run) => modeOf(run) === mode);
    return list.length ? { mode, total: median(list.map((run) => run.totalMs)) } : null;
  }).filter(Boolean);
  if (perMode.length) {
    perMode.sort((a, b) => a.total - b.total);
    add(
      `Fastest median total: ${modeLabel(perMode[0].mode)} (${fmtMs(perMode[0].total)}). ` +
        "Hybrid rows share the same batch tail, so read the first-text line for the real benefit."
    );
  }

  const failed = all.filter((run) => run.status !== "completed").length;
  if (failed) add(`${failed} failed run(s) excluded.`);
}

// ── exports ──────────────────────────────────────────────────────────────────

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function exportRunsJson() {
  download(
    `sarvam-bench-${stamp()}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), runs: loadRuns() }, null, 2),
    "application/json"
  );
  log("info", "history exported", { count: loadRuns().length });
}

function exportRunsCsv() {
  const header = [
    "at",
    "label",
    "runMode",
    "rail",
    "durationSec",
    "audioBytes",
    "model",
    "mode",
    "diarization",
    "preInitiated",
    "totalMs",
    "ratio",
    "providerWaitMs",
    "overheadMs",
    "firstTextMs",
    "firstFinalMs",
    "segmentCount",
    "probeCount",
    "transcriptChars",
    "turnCount",
    "status",
    "error",
  ];
  const rows = loadRuns().map((r) =>
    [
      r.at,
      r.label ?? "",
      r.runMode ?? "",
      r.rail ?? "",
      r.durationSec ?? "",
      r.audioBytes ?? "",
      r.model ?? "",
      r.mode ?? "",
      r.diarization ? 1 : 0,
      r.preInitiated ? 1 : 0,
      r.totalMs ?? "",
      r.ratio ?? "",
      r.providerWaitMs ?? "",
      r.overheadMs ?? "",
      r.firstTextMs ?? "",
      r.firstFinalMs ?? "",
      r.segmentCount ?? "",
      r.probeCount ?? "",
      r.transcriptChars ?? "",
      r.turnCount ?? "",
      r.status ?? "",
      String(r.error ?? "").replace(/[\r\n]+/g, " "),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  download(`sarvam-bench-${stamp()}.csv`, [header.join(","), ...rows].join("\n"), "text/csv");
  log("info", "history exported as CSV", { count: rows.length });
}

function exportLogs() {
  download(`sarvam-log-${stamp()}.json`, JSON.stringify(readLog(), null, 2), "application/json");
}

// ── wiring ───────────────────────────────────────────────────────────────────

el("record-btn").addEventListener("click", startRecording);
el("stop-btn").addEventListener("click", stopRecording);
el("refresh-bench").addEventListener("click", renderBenchmarks);
el("save-clip-btn").addEventListener("click", saveClip);
el("run-clip-btn").addEventListener("click", runSelectedClip);
el("delete-clip-btn").addEventListener("click", deleteSelectedClip);
el("run-mode").addEventListener("change", () => {
  const mode = runMode();
  const notes = {
    "batch-on": "Batch only: one job with diarization ON. This is the production path.",
    "batch-off": "Batch only with diarization OFF. Baseline for how much diarization costs us.",
    "hybrid-rest": "Hybrid: 15–25 s PCM windows go to the REST endpoint for a provisional preview; the batch job with diarization ON remains authoritative.",
    "hybrid-stream": state.realtimeKey
      ? "Hybrid: the realtime WebSocket supplies partials and finals during the visit; the batch job with diarization ON remains authoritative. Tester only — the API key is visible in devtools."
      : "Realtime streaming is not configured (no SARVAM_API_KEY in /api/config).",
  };
  el("run-mode-note").textContent = notes[mode] || "";
});
el("export-json").addEventListener("click", exportRunsJson);
el("export-csv").addEventListener("click", exportRunsCsv);
el("export-logs").addEventListener("click", exportLogs);

el("clear-runs").addEventListener("click", () => {
  if (!confirm("Delete the saved run history in this browser?")) return;
  localStorage.removeItem(RUNS_KEY);
  renderHistory();
  renderBenchmarks();
  log("warn", "history cleared");
});

el("clear-logs").addEventListener("click", () => {
  if (!confirm("Delete the saved log in this browser?")) return;
  localStorage.removeItem(LOGS_KEY);
  renderLog();
});

el("file-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.lastBlob = file;
  state.lastMime = mimeForFile(file);
  state.lastFileName = file.name;
  const probed = await probeDuration(file);
  state.lastDuration = probed ?? 0;
  el("clip-seconds").value = probed ? probed.toFixed(1) : "";
  if (!el("clip-name").value.trim()) {
    el("clip-name").value = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
  }
  el("rerun-btn").disabled = false;
  log("info", "file selected", { bytes: file.size, seconds: probed ?? "unknown", type: state.lastMime });
  state.liveSource = runMode().startsWith("hybrid") ? "file" : null;
  state.hybridSummary = null;
  await runPipeline(file, state.lastMime, state.lastDuration);
});

el("rerun-btn").addEventListener("click", async () => {
  if (!state.lastBlob) return;
  state.liveSource = runMode().startsWith("hybrid") ? "file" : null;
  state.hybridSummary = null;
  await runPipeline(state.lastBlob, state.lastMime, state.lastDuration);
});

loadConfig();
renderHistory();
renderBenchmarks();
renderLog();
