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
  stream: null,
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

// ── options ──────────────────────────────────────────────────────────────────

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
}

function buildParams(durationSec) {
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
    label: el("label").value.trim(),
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

async function handleRecordingStopped() {
  const durationSec = (Date.now() - state.startedAt) / 1000;
  const blob = new Blob(state.chunks, { type: state.mimeType });
  state.chunks = [];
  state.lastBlob = blob;
  state.lastMime = state.mimeType;
  state.lastDuration = durationSec;
  el("rerun-btn").disabled = false;
  await submit(blob, state.mimeType, durationSec);
  state.preJob = null;
}

// ── runs ─────────────────────────────────────────────────────────────────────

async function submit(blob, mimeType, durationSec) {
  const params = buildParams(durationSec);
  const response = await fetch(`/api/runs?${params}`, {
    method: "POST",
    headers: { "Content-Type": mimeType },
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

// ── history ──────────────────────────────────────────────────────────────────

async function refreshHistory() {
  const runs = await fetch("/api/runs").then((r) => r.json());
  const body = document.querySelector("#history tbody");
  body.innerHTML = "";
  for (const run of runs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(run.createdAt).toLocaleTimeString()}</td>
      <td>${escapeHtml(run.label || "—")}</td>
      <td>${run.durationSec ? `${run.durationSec.toFixed(0)} s` : "—"}</td>
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
el("transport").addEventListener("change", syncTransportUi);
el("refresh-btn").addEventListener("click", refreshHistory);

el("file-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.lastBlob = file;
  state.lastMime = file.type || "audio/webm";
  state.lastDuration = 0;
  el("rerun-btn").disabled = false;
  await submit(file, state.lastMime, 0);
});

el("rerun-btn").addEventListener("click", async () => {
  if (!state.lastBlob) return;
  await submit(state.lastBlob, state.lastMime, state.lastDuration);
});

syncTransportUi();
loadConfig();
refreshHistory();
