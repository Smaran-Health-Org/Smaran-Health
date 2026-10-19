/**
 * Sarvam probe UI. Plain DOM, no build step.
 *
 * Everything this page does maps to a lever in docs/development/
 * transcription-latency-experiments.md, so runs can be compared by the numbers
 * the server reports instead of by feel.
 */

const el = (id) => document.getElementById(id);

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const state = {
  recorder: null,
  chunks: [],
  startedAt: 0,
  timerId: null,
  mimeType: "audio/webm",
  preJob: null,
  lastBlob: null,
  lastMime: "audio/webm",
  lastDuration: 0,
  lastSourceName: "",
  stream: null,
  fixtures: [],
  selectedFixture: null,
};

// ── formatting ───────────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtClock(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ── canonical audio (16 kHz mono WAV) ────────────────────────────────────────

function encodeWav(audioBuffer) {
  const frames = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const dataBytes = frames * 2;
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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  const samples = audioBuffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([out], { type: "audio/wav" });
}

async function decodeAudio(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio is unavailable in this browser.");
  const context = new Ctx();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    context.close?.();
  }
}

/** Decode → resample to 16 kHz mono → re-encode as PCM WAV. */
async function toCanonicalWav(blob) {
  const decoded = await decodeAudio(blob);
  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("OfflineAudioContext is unavailable.");
  const offline = new Offline(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return { blob: encodeWav(rendered), durationSec: rendered.duration };
}

async function durationOf(blob) {
  try {
    return (await decodeAudio(blob)).duration;
  } catch {
    return 0;
  }
}

/**
 * Applies the canonical-WAV checkbox. Duration always comes from decoding when
 * possible, so the ratio column is populated even for uploaded files.
 */
async function prepareAudio(blob, mimeType, durationHint) {
  if (el("canonicalise").checked) {
    try {
      const canonical = await toCanonicalWav(blob);
      return {
        blob: canonical.blob,
        mimeType: "audio/wav",
        durationSec: canonical.durationSec,
        converted: true,
      };
    } catch (error) {
      setFixtureStatus(
        `Could not convert (${error.message}); using the original file instead.`,
        true
      );
    }
  }
  const durationSec = durationHint || (await durationOf(blob));
  return { blob, mimeType, durationSec, converted: false };
}

// ── options ──────────────────────────────────────────────────────────────────

const SETTINGS_KEY = "sarvam-probe-settings";
const SETTING_IDS = [
  "transport",
  "model",
  "mode",
  "language",
  "diarization",
  "num-speakers",
  "keep-alive",
  "poll-ms",
  "segments",
  "concurrency",
  "label",
];

function saveSettings() {
  const data = {};
  for (const id of SETTING_IDS) {
    const node = el(id);
    if (node) data[id] = node.value;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* storage can be disabled; settings are a convenience only */
  }
}

function restoreSettings() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return;
  }
  for (const id of SETTING_IDS) {
    const node = el(id);
    if (!node || data[id] === undefined) continue;
    if (node.tagName === "SELECT") {
      if ([...node.options].some((option) => option.value === data[id])) node.value = data[id];
    } else {
      node.value = data[id];
    }
  }
}

async function loadConfig() {
  const config = await fetch("/api/config").then((r) => r.json());
  const model = el("model");
  const mode = el("mode");
  const language = el("language");

  model.innerHTML = config.models
    .map((value) => `<option value="${value}">${value}</option>`)
    .join("");
  model.value = config.defaultModel;

  mode.innerHTML = config.modes
    .map((value) => `<option value="${value}">${value}</option>`)
    .join("");
  mode.value = "codemix";

  language.innerHTML = config.languages
    .map((value) => `<option value="${value}">${value}</option>`)
    .join("");
  language.value = "unknown";

  const chip = el("key-state");
  if (config.hasKey) {
    chip.textContent = "API key loaded";
    chip.classList.add("ok");
  } else {
    chip.textContent = "API key missing — add .env";
    chip.classList.add("bad");
  }

  restoreSettings();
  syncTransportUi();
}

function buildParams(durationSec, autoLabel) {
  const params = new URLSearchParams({
    transport: el("transport").value,
    model: el("model").value,
    mode: el("mode").value,
    language: el("language").value,
    diarization: el("diarization").value,
    keepAlive: el("keep-alive").value,
    pollMs: el("poll-ms").value || "2000",
    segments: el("segments").value || "1",
    concurrency: el("concurrency").value || "1",
    label: el("label").value.trim() || autoLabel || "",
  });
  const speakers = el("num-speakers").value;
  if (speakers) params.set("numSpeakers", speakers);
  if (durationSec) params.set("durationSec", String(Math.round(durationSec)));
  if (state.preJob) params.set("jobId", state.preJob);
  return params;
}

function syncTransportUi() {
  const isRest = el("transport").value === "rest";
  for (const node of document.querySelectorAll(".rest-only")) {
    node.style.display = isRest ? "" : "none";
  }
}

// ── recording ────────────────────────────────────────────────────────────────

function pickMimeType() {
  for (const candidate of MIME_CANDIDATES) {
    if (window.MediaRecorder?.isTypeSupported?.(candidate)) return candidate;
  }
  return "";
}

async function startRecording() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    alert(`Microphone unavailable: ${error.message}`);
    return;
  }

  state.mimeType = pickMimeType() || "audio/webm";
  state.chunks = [];
  state.recorder = new MediaRecorder(state.stream, { mimeType: state.mimeType });
  state.recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) state.chunks.push(event.data);
  };
  state.recorder.onstop = handleRecordingStopped;
  // 1 s timeslice mirrors the real app; the blob is reassembled on stop.
  state.recorder.start(1000);

  state.startedAt = Date.now();
  state.preJob = null;

  el("record-btn").disabled = true;
  el("record-btn").classList.add("recording");
  el("stop-btn").disabled = false;
  el("level").textContent = `format: ${state.mimeType}`;

  state.timerId = setInterval(() => {
    el("timer").textContent = fmtClock(Date.now() - state.startedAt);
  }, 250);

  // E2: pay the ~2.2 s initiate cost while the doctor is still talking.
  if (el("pre-initiate").checked) {
    el("level").textContent = "pre-initiating job…";
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: el("model").value,
          mode: el("mode").value,
          language: el("language").value,
          diarization: el("diarization").value === "1",
          numSpeakers: Number(el("num-speakers").value) || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "initiate failed");
      state.preJob = data.jobId;
      el("level").textContent = `job ${data.jobId} ready (${fmtMs(data.durationMs)})`;
    } catch (error) {
      el("level").textContent = `pre-initiate failed: ${error.message}`;
    }
  }
}

function stopRecording() {
  if (!state.recorder || state.recorder.state === "inactive") return;
  state.recorder.stop();
  clearInterval(state.timerId);
  el("record-btn").disabled = false;
  el("record-btn").classList.remove("recording");
  el("stop-btn").disabled = true;
  state.stream?.getTracks().forEach((track) => track.stop());
}

function extForMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("flac")) return "flac";
  return "webm";
}

async function handleRecordingStopped() {
  const durationSec = (Date.now() - state.startedAt) / 1000;
  const blob = new Blob(state.chunks, { type: state.mimeType });
  state.chunks = [];
  el("save-recording-btn").disabled = false;
  setFixtureStatus("Preparing recording…");

  const prepared = await prepareAudio(blob, state.mimeType, durationSec);
  state.lastBlob = prepared.blob;
  state.lastMime = prepared.mimeType;
  state.lastDuration = prepared.durationSec;
  state.lastSourceName = `recording-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.${extForMime(prepared.mimeType)}`;

  if (!el("fixture-name").value.trim()) {
    el("fixture-name").value = state.lastSourceName.replace(/\.[^.]+$/, "");
  }
  if (!el("fixture-note").value.trim()) {
    el("fixture-note").value = `Recorded ${new Date().toLocaleString()} — ${prepared.durationSec.toFixed(
      1
    )} s`;
  }
  setFixtureStatus(`Recording ready (${prepared.durationSec.toFixed(1)} s).`);
  await submit(prepared.blob, prepared.mimeType, prepared.durationSec);
  state.preJob = null;
}

// ── runs ─────────────────────────────────────────────────────────────────────

async function submit(blob, mimeType, durationSec, sourceName) {
  const params = buildParams(durationSec);
  const response = await fetch(`/api/runs?${params}`, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "x-filename": sourceName || state.lastSourceName || `clip.${extForMime(mimeType)}`,
    },
    body: blob,
  });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || "Could not start the run.");
    return;
  }
  attachRun(data.id, params.get("label"), durationSec);
  refreshHistory();
}

function attachRun(id, label, durationSec) {
  const card = document.createElement("article");
  card.className = "run";
  card.innerHTML = `
    <div class="run-head">
      <span class="run-title">${label || id}</span>
      <span class="chip">${id}</span>
      <span class="muted small">${durationSec ? `rec ${durationSec.toFixed(1)} s` : ""}</span>
      <span class="run-total chip">running…</span>
    </div>
    <div class="steps"></div>
    <div class="notes"></div>
    <div class="result"></div>`;
  el("run-list").prepend(card);

  const stepsBox = card.querySelector(".steps");
  const notesBox = card.querySelector(".notes");
  const resultBox = card.querySelector(".result");
  const totalChip = card.querySelector(".run-total");
  const pending = new Map();

  const source = new EventSource(`/api/runs/${id}/events`);
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);

    if (event.type === "step.start") {
      const row = document.createElement("div");
      row.className = "step pending";
      row.innerHTML = `<span class="name">${event.step}</span><span class="ms">…</span><span class="detail"></span>`;
      stepsBox.appendChild(row);
      pending.set(event.step, row);
      return;
    }

    if (event.type === "step") {
      const row = pending.get(event.step) ?? document.createElement("div");
      if (!pending.has(event.step)) stepsBox.appendChild(row);
      row.className = `step ${event.ok ? "" : "failed"}`;
      const detail = event.detail ? summarizeDetail(event.detail) : event.error ?? "";
      row.innerHTML = `<span class="name">${event.step}</span><span class="ms">${fmtMs(
        event.durationMs
      )}</span><span class="detail">${escapeHtml(detail)}</span>`;
      pending.delete(event.step);
      return;
    }

    if (event.type === "note") {
      const line = document.createElement("div");
      line.className = "note";
      line.textContent = event.message;
      notesBox.appendChild(line);
      return;
    }

    if (event.type === "run.failed") {
      totalChip.textContent = "failed";
      totalChip.classList.add("bad");
      const line = document.createElement("div");
      line.className = "note";
      line.style.color = "var(--bad)";
      line.textContent = event.error;
      notesBox.appendChild(line);
      return;
    }

    if (event.type === "run.done") {
      source.close();
      totalChip.textContent = `${fmtMs(event.summary.totalMs)}${
        event.summary.ratio ? ` · ×${event.summary.ratio}` : ""
      }`;
      if (event.status !== "completed") totalChip.classList.add("bad");

      if (event.turns?.length) {
        resultBox.appendChild(renderTurns(event.turns));
      }
      if (event.transcript) {
        const text = document.createElement("div");
        text.className = "transcript";
        text.textContent = event.transcript;
        resultBox.appendChild(text);
      }
      refreshHistory();
    }
  };
  source.onerror = () => {
    source.close();
    if (totalChip.textContent === "running…") totalChip.textContent = "stream closed";
  };
}

function summarizeDetail(detail) {
  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join("  ");
}

function renderTurns(turns) {
  const box = document.createElement("div");
  box.className = "turns";
  for (const turn of turns) {
    const row = document.createElement("div");
    row.className = "turn";
    const time =
      turn.startTimeSeconds === null
        ? ""
        : `${Number(turn.startTimeSeconds).toFixed(1)}→${Number(turn.endTimeSeconds ?? 0).toFixed(1)}`;
    row.innerHTML = `<span class="who">S${escapeHtml(turn.speakerId)}</span><span class="time">${time}</span><span>${escapeHtml(
      turn.transcript
    )}</span>`;
    box.appendChild(row);
  }
  return box;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

// ── clip library ─────────────────────────────────────────────────────────────

function setFixtureStatus(message, bad = false) {
  const node = el("fixture-status");
  if (!node) return;
  node.textContent = message;
  node.style.color = bad ? "var(--bad)" : "";
}

async function loadFixtures() {
  try {
    const data = await fetch("/api/fixtures").then((response) => response.json());
    state.fixtures = data.fixtures ?? [];
    if (state.selectedFixture && !state.fixtures.some((f) => f.id === state.selectedFixture)) {
      state.selectedFixture = null;
    }
    renderFixtures();
  } catch (error) {
    setFixtureStatus(`Could not load clips: ${error.message}`, true);
  }
}

function renderFixtures() {
  const body = document.querySelector("#fixtures tbody");
  if (!body) return;
  body.innerHTML = "";

  if (state.fixtures.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="muted small">No clips saved yet — record or upload one, name it, then save.</td>`;
    body.appendChild(row);
    el("run-fixture-btn").disabled = true;
    el("fixture-selected").textContent = "no clip selected";
    const audio = el("fixture-audio");
    audio.hidden = true;
    audio.removeAttribute("src");
    return;
  }

  for (const fixture of state.fixtures) {
    const row = document.createElement("tr");
    if (fixture.id === state.selectedFixture) row.classList.add("selected");
    row.innerHTML = `
      <td>${escapeHtml(fixture.name)}</td>
      <td class="muted small">${escapeHtml(fixture.note || "—")}</td>
      <td>${fixture.durationSec ? `${fixture.durationSec.toFixed(1)} s` : "—"}</td>
      <td>${fmtBytes(fixture.bytes)}</td>
      <td>${escapeHtml(fixture.mimeType.replace("audio/", ""))}${
        fixture.converted ? " · 16k" : ""
      }</td>
      <td>${fixture.runs ?? 0}</td>
      <td class="row-actions">
        <button data-act="run">run</button>
        <button data-act="edit">edit</button>
        <button data-act="delete">delete</button>
      </td>`;
    row.addEventListener("click", (event) => {
      if (event.target.dataset.act) return;
      selectFixture(fixture.id);
    });
    row.querySelector('[data-act="run"]').addEventListener("click", async () => {
      selectFixture(fixture.id);
      await runFixture(fixture.id);
    });
    row.querySelector('[data-act="edit"]').addEventListener("click", () => editFixture(fixture));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => deleteFixture(fixture));
    body.appendChild(row);
  }
}

function selectFixture(id) {
  state.selectedFixture = id;
  const fixture = state.fixtures.find((item) => item.id === id) ?? null;
  el("run-fixture-btn").disabled = !fixture;
  const label = el("fixture-selected");
  const audio = el("fixture-audio");

  if (!fixture) {
    label.textContent = "no clip selected";
    audio.hidden = true;
    audio.removeAttribute("src");
  } else {
    label.textContent = `${fixture.name} · ${
      fixture.durationSec ? `${fixture.durationSec.toFixed(1)} s` : "length unknown"
    } · ${fmtBytes(fixture.bytes)}`;
    audio.src = `/api/fixtures/${fixture.id}/audio`;
    audio.hidden = false;
  }
  for (const row of document.querySelectorAll("#fixtures tbody tr")) {
    row.classList.toggle("selected", false);
  }
  renderFixtures();
}

async function saveFixture(blob, mimeType, sourceName, durationHint) {
  const name = el("fixture-name").value.trim();
  const note = el("fixture-note").value.trim();
  if (!name) {
    setFixtureStatus("Give the clip a name first.", true);
    el("fixture-name").focus();
    return null;
  }

  setFixtureStatus("Preparing audio…");
  const prepared = await prepareAudio(blob, mimeType, durationHint);

  const params = new URLSearchParams({
    name,
    note,
    sourceName: sourceName || state.lastSourceName || "clip",
    converted: prepared.converted ? "1" : "0",
  });
  if (prepared.durationSec) params.set("durationSec", prepared.durationSec.toFixed(1));

  setFixtureStatus("Saving…");
  const response = await fetch(`/api/fixtures?${params}`, {
    method: "POST",
    headers: {
      "Content-Type": prepared.mimeType,
      "x-filename": sourceName || state.lastSourceName || "clip",
    },
    body: prepared.blob,
  });
  const data = await response.json();
  if (!response.ok) {
    setFixtureStatus(data.error || "Save failed.", true);
    return null;
  }

  setFixtureStatus(
    `${data.duplicate ? "Already in the library" : "Saved"}: ${data.fixture.name} · ${
      data.fixture.durationSec ? `${data.fixture.durationSec.toFixed(1)} s` : "length unknown"
    } · ${fmtBytes(data.fixture.bytes)}`
  );
  el("fixture-name").value = "";
  el("fixture-note").value = "";
  await loadFixtures();
  selectFixture(data.fixture.id);
  return data.fixture;
}

async function saveSelectedFile() {
  const file = el("file-input").files?.[0];
  if (!file) {
    setFixtureStatus("Choose an audio file first.", true);
    return;
  }
  await saveFixture(file, file.type || "", file.name, 0);
  el("file-input").value = "";
  el("run-upload-btn").disabled = true;
}

async function saveLastRecording() {
  if (!state.lastBlob) {
    setFixtureStatus("No recording in memory yet.", true);
    return;
  }
  await saveFixture(state.lastBlob, state.lastMime, state.lastSourceName, state.lastDuration);
}

async function runFixture(fixtureId) {
  const fixture = state.fixtures.find((item) => item.id === (fixtureId ?? state.selectedFixture));
  if (!fixture) return;

  const params = buildParams(fixture.durationSec || 0, fixture.name);
  params.set("fixture", fixture.id);

  const response = await fetch(`/api/runs?${params}`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || "Could not start the run.");
    return;
  }
  attachRun(data.id, params.get("label"), fixture.durationSec || 0);
  refreshHistory();
  loadFixtures();
}

async function runUploadOnce() {
  const file = el("file-input").files?.[0];
  if (!file) return;
  setFixtureStatus("Preparing audio…");
  const prepared = await prepareAudio(file, file.type || "", 0);
  state.lastBlob = prepared.blob;
  state.lastMime = prepared.mimeType;
  state.lastDuration = prepared.durationSec;
  state.lastSourceName = file.name;
  setFixtureStatus(`Running ${file.name} once (not saved).`);
  await submit(prepared.blob, prepared.mimeType, prepared.durationSec, file.name);
}

async function editFixture(fixture) {
  const name = window.prompt("Clip name", fixture.name);
  if (name === null) return;
  const note = window.prompt("What's in this recording", fixture.note || "");
  if (note === null) return;
  const response = await fetch(`/api/fixtures/${fixture.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, note }),
  });
  const data = await response.json();
  if (!response.ok) {
    setFixtureStatus(data.error || "Could not update the clip.", true);
    return;
  }
  await loadFixtures();
  selectFixture(fixture.id);
  setFixtureStatus("Clip updated.");
}

async function deleteFixture(fixture) {
  if (!window.confirm(`Delete clip "${fixture.name}"? Runs already recorded stay in history.`)) {
    return;
  }
  const response = await fetch(`/api/fixtures/${fixture.id}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) {
    setFixtureStatus(data.error || "Could not delete the clip.", true);
    return;
  }
  if (state.selectedFixture === fixture.id) state.selectedFixture = null;
  await loadFixtures();
  setFixtureStatus(`Deleted ${fixture.name}.`);
}

// ── history ──────────────────────────────────────────────────────────────────

async function refreshHistory() {
  const runs = await fetch("/api/runs").then((r) => r.json());
  const body = document.querySelector("#history tbody");
  body.innerHTML = "";
  for (const run of runs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(run.createdAt).toLocaleTimeString()}</td>
      <td>${escapeHtml(run.fixtureName || "—")}</td>
      <td>${escapeHtml(run.label || "—")}</td>
      <td>${run.durationSec ? `${run.durationSec.toFixed(1)} s` : "—"}</td>
      <td>${run.transport}</td>
      <td>${run.model}${run.diarization ? "" : " · nodiar"}</td>
      <td>${run.keepAlive ? "on" : "off"}</td>
      <td>${fmtMs(run.totalMs)}</td>
      <td>${run.ratio ?? "—"}</td>
      <td class="${run.status === "completed" ? "" : "bad"}">${run.status}</td>`;
    row.addEventListener("click", () => showInspector(run.id));
    body.appendChild(row);
  }
}

async function showInspector(id) {
  const detail = await fetch(`/api/runs/${id}`).then((r) => r.json());
  const box = el("inspector");
  el("inspector-card").hidden = false;
  box.innerHTML = "";

  const head = document.createElement("div");
  head.className = "run-head";
  head.innerHTML = `<span class="run-title">${escapeHtml(detail.label || detail.id)}</span>
    <span class="chip">${detail.transport}</span>
    <span class="chip">${detail.model}</span>
    <span class="chip">${detail.keepAlive ? "keep-alive" : "cold"}</span>
    <span class="run-total chip">${fmtMs(detail.totalMs)}${detail.ratio ? ` · ×${detail.ratio}` : ""}</span>`;
  box.appendChild(head);

  const steps = document.createElement("div");
  steps.className = "steps";
  for (const step of detail.steps ?? []) {
    const row = document.createElement("div");
    row.className = `step ${step.ok ? "" : "failed"}`;
    row.innerHTML = `<span class="name">${step.step}</span><span class="ms">${fmtMs(
      step.durationMs
    )}</span><span class="detail">${escapeHtml(step.error ?? step.jobState ?? "")}</span>`;
    steps.appendChild(row);
  }
  box.appendChild(steps);

  if (detail.error) {
    const line = document.createElement("div");
    line.className = "note";
    line.style.color = "var(--bad)";
    line.textContent = detail.error;
    box.appendChild(line);
  }
  if (detail.turns?.length) box.appendChild(renderTurns(detail.turns));
  if (detail.transcript) {
    const text = document.createElement("div");
    text.className = "transcript";
    text.textContent = detail.transcript;
    box.appendChild(text);
  }
  const raw = document.createElement("pre");
  raw.textContent = JSON.stringify(detail.raw ?? {}, null, 2);
  box.appendChild(raw);
}

// ── wiring ───────────────────────────────────────────────────────────────────

el("record-btn").addEventListener("click", startRecording);
el("stop-btn").addEventListener("click", stopRecording);
el("refresh-btn").addEventListener("click", refreshHistory);
el("save-fixture-btn").addEventListener("click", saveSelectedFile);
el("run-upload-btn").addEventListener("click", runUploadOnce);
el("save-recording-btn").addEventListener("click", saveLastRecording);
el("run-fixture-btn").addEventListener("click", () => runFixture());

el("file-input").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  el("run-upload-btn").disabled = !file;
  if (!file) return;
  if (!el("fixture-name").value.trim()) {
    el("fixture-name").value = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
  }
  setFixtureStatus(`${file.name} · ${fmtBytes(file.size)} selected.`);
});

syncTransportUi();
loadConfig();
loadFixtures();
refreshHistory();

for (const id of SETTING_IDS) {
  const node = el(id);
  if (node) node.addEventListener("change", saveSettings);
}
el("transport").addEventListener("change", syncTransportUi);
