/**
 * Cloud (Vercel) UI for the Sarvam probe.
 *
 * Differs from `app.js` on purpose: a serverless function cannot hold a run, so this
 * page drives the state machine itself — initiate → presign → PUT → start → poll →
 * download — and measures each hop with `performance.now()`.
 *
 * The PUT goes straight from the browser to Sarvam's presigned storage URL. That keeps
 * the audio under Vercel's 4.5 MB request-body limit and simultaneously answers the
 * open question of whether that container allows cross-origin uploads.
 */

const el = (id) => document.getElementById(id);
const HISTORY_KEY = "sarvam-probe-runs";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const state = {
  recorder: null,
  chunks: [],
  mimeType: "audio/webm",
  startedAt: 0,
  timerId: null,
  stream: null,
  preJob: null,
  lastBlob: null,
  lastMime: "audio/webm",
  lastDuration: 0,
  busy: false,
};

const fmtMs = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtClock = (ms) => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const escapeHtml = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function extForMime(mime) {
  const clean = String(mime || "").split(";")[0].trim().toLowerCase();
  if (clean === "audio/mp4" || clean === "audio/x-m4a") return "m4a";
  if (clean === "audio/ogg" || clean === "audio/opus") return "ogg";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "audio/wav" || clean === "audio/x-wav") return "wav";
  return "webm";
}

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
    if (event.data?.size > 0) state.chunks.push(event.data);
  };
  state.recorder.onstop = handleStopped;
  state.recorder.start(1000);

  state.startedAt = Date.now();
  el("record-btn").disabled = true;
  el("record-btn").classList.add("recording");
  el("stop-btn").disabled = false;
  el("level").textContent = `format: ${state.mimeType}`;
  state.timerId = setInterval(() => {
    el("timer").textContent = fmtClock(Date.now() - state.startedAt);
  }, 250);

  state.preJob = null;
  if (el("pre-initiate").checked) {
    el("level").textContent = "pre-initiating job…";
    try {
      const response = await fetch("/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "initiate failed");
      state.preJob = { jobId: data.jobId, ms: data.ms };
      el("level").textContent = `job ready in ${fmtMs(data.ms)} — E2 cost already paid`;
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

async function handleStopped() {
  const durationSec = (Date.now() - state.startedAt) / 1000;
  const blob = new Blob(state.chunks, { type: state.mimeType });
  state.chunks = [];
  state.lastBlob = blob;
  state.lastMime = state.mimeType;
  state.lastDuration = durationSec;
  el("rerun-btn").disabled = false;
  await runPipeline(blob, state.mimeType, durationSec);
  state.preJob = null;
}

function settings() {
  return {
    model: el("model").value,
    mode: el("mode").value,
    language: el("language").value,
    diarization: el("diarization").value === "1",
  };
}

// ── pipeline ─────────────────────────────────────────────────────────────────

function newPanel() {
  const panel = el("run-panel");
  panel.innerHTML = `
    <article class="run">
      <div class="run-head">
        <span class="run-title">${escapeHtml(el("label").value.trim() || "run")}</span>
        <span class="run-total chip">running…</span>
      </div>
      <div class="steps"></div>
      <div class="notes"></div>
      <div class="result"></div>
    </article>`;
  return {
    total: panel.querySelector(".run-total"),
    steps: panel.querySelector(".steps"),
    notes: panel.querySelector(".notes"),
    result: panel.querySelector(".result"),
  };
}

function addStep(panel, name, ok, durationMs, detail) {
  const row = document.createElement("div");
  row.className = `step ${ok ? "" : "failed"}`;
  row.innerHTML = `<span class="name">${escapeHtml(name)}</span><span class="ms">${fmtMs(
    durationMs
  )}</span><span class="detail">${escapeHtml(detail ?? "")}</span>`;
  panel.steps.appendChild(row);
}

function note(panel, text, bad = false) {
  const line = document.createElement("div");
  line.className = "note";
  if (bad) line.style.color = "var(--bad)";
  line.textContent = text;
  panel.notes.appendChild(line);
}

async function jsonStep(panel, name, url, options) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  const ms = Math.round(performance.now() - startedAt);
  const ok = response.ok;
  addStep(panel, name, ok, data.ms ?? ms, data.error ?? "");
  if (!ok) throw new Error(data.error || `${name} failed (${response.status})`);
  return data;
}

async function runPipeline(blob, mimeType, durationSec) {
  if (state.busy) return;
  state.busy = true;
  const panel = newPanel();
  const t0 = performance.now();
  const record = {
    at: new Date().toISOString(),
    label: el("label").value.trim(),
    durationSec: durationSec || null,
    model: el("model").value,
    diarization: el("diarization").value === "1",
    status: "running",
    totalMs: null,
    steps: [],
  };

  try {
    // 1. Job — either already initiated during recording, or initiate now.
    let jobId;
    if (state.preJob) {
      jobId = state.preJob.jobId;
      addStep(panel, "batch.initiate", true, 0, "pre-initiated during recording (E2)");
    } else {
      const job = await jsonStep(panel, "batch.initiate", "/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings()),
      });
      jobId = job.jobId;
    }

    // 2. Presigned URL for this one file.
    const fileName = `part-1.${extForMime(mimeType)}`;
    const presign = await jsonStep(panel, "batch.upload_url", "/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, files: [fileName] }),
    });
    const uploadUrl = presign.files[fileName];
    if (!uploadUrl) throw new Error("No presigned upload URL returned.");

    // 3. Direct browser → Sarvam storage. This is also the CORS probe (§7.11).
    const putStartedAt = performance.now();
    try {
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "x-ms-blob-type": "BlockBlob" },
        body: blob,
      });
      addStep(panel, "batch.upload_put", put.ok, Math.round(performance.now() - putStartedAt), `${(blob.size / 1024).toFixed(0)} KB · direct to storage`);
      if (!put.ok) throw new Error(`upload rejected (${put.status})`);
      note(panel, "Direct browser upload worked — Sarvam's storage allows this origin (CORS ok).");
    } catch (error) {
      addStep(panel, "batch.upload_put", false, Math.round(performance.now() - putStartedAt), "CORS blocked");
      throw new Error(
        `Direct upload blocked (${error.message}). Sarvam's storage does not allow this origin — ` +
          `the deployment needs a chunked server proxy instead. This is the §7.11 answer.`
      );
    }

    // 4. Start.
    await jsonStep(panel, "batch.start", "/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    // 5. Poll. The browser owns this loop; no function is held open.
    const pollMs = Math.max(500, Number(el("poll-ms").value) || 2000);
    const deadline = Date.now() + 15 * 60 * 1000;
    const waitStartedAt = performance.now();
    let probes = 0;
    let status;
    for (;;) {
      status = await jsonStep(panel, `batch.status#${++probes}`, `/api/status?jobId=${encodeURIComponent(jobId)}`, {
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
    const providerWaitMs = Math.round(performance.now() - waitStartedAt);
    note(panel, `Provider wait: ${(providerWaitMs / 1000).toFixed(1)} s over ${probes} probe(s).`);

    // 6. Transcript.
    const result = await jsonStep(panel, "batch.download", "/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, files: status.outputFiles }),
    });

    if (result.turns?.length) {
      const box = document.createElement("div");
      box.className = "turns";
      for (const turn of result.turns) {
        const row = document.createElement("div");
        row.className = "turn";
        const time =
          turn.startTimeSeconds == null
            ? ""
            : `${Number(turn.startTimeSeconds).toFixed(1)}→${Number(turn.endTimeSeconds ?? 0).toFixed(1)}`;
        row.innerHTML = `<span class="who">S${escapeHtml(turn.speakerId)}</span><span class="time">${time}</span><span>${escapeHtml(turn.transcript)}</span>`;
        box.appendChild(row);
      }
      panel.result.appendChild(box);
    }
    const text = document.createElement("div");
    text.className = "transcript";
    text.textContent = result.transcript || "(empty transcript)";
    panel.result.appendChild(text);

    const totalMs = Math.round(performance.now() - t0);
    const ratio = durationSec ? (totalMs / 1000 / durationSec).toFixed(2) : null;
    panel.total.textContent = `${fmtMs(totalMs)}${ratio ? ` · ×${ratio}` : ""}`;
    record.status = "completed";
    record.totalMs = totalMs;
    record.ratio = ratio ? Number(ratio) : null;
    record.transcriptChars = (result.transcript || "").length;
  } catch (error) {
    record.status = "failed";
    record.error = error.message;
    record.totalMs = Math.round(performance.now() - t0);
    panel.total.textContent = "failed";
    panel.total.classList.add("bad");
    note(panel, error.message, true);
  } finally {
    state.busy = false;
    saveRun(record);
    renderHistory();
  }
}

// ── history (localStorage: no server state) ──────────────────────────────────

function loadRuns() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRun(record) {
  const runs = loadRuns();
  runs.unshift(record);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(0, 100)));
}

function renderHistory() {
  const body = document.querySelector("#history tbody");
  body.innerHTML = "";
  for (const run of loadRuns()) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(run.at).toLocaleTimeString()}</td>
      <td>${escapeHtml(run.label || "—")}</td>
      <td>${run.durationSec ? `${run.durationSec.toFixed(0)} s` : "—"}</td>
      <td>${escapeHtml(run.model)}${run.diarization ? "" : " · nodiar"}</td>
      <td>${fmtMs(run.totalMs)}</td>
      <td>${run.ratio ?? "—"}</td>
      <td class="${run.status === "completed" ? "" : "bad"}">${run.status}</td>`;
    body.appendChild(row);
  }
}

// ── wiring ───────────────────────────────────────────────────────────────────

el("record-btn").addEventListener("click", startRecording);
el("stop-btn").addEventListener("click", stopRecording);
el("refresh-btn").addEventListener("click", renderHistory);

el("file-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.lastBlob = file;
  state.lastMime = file.type || "audio/webm";
  state.lastDuration = 0;
  el("rerun-btn").disabled = false;
  await runPipeline(file, state.lastMime, 0);
});

el("rerun-btn").addEventListener("click", async () => {
  if (!state.lastBlob) return;
  await runPipeline(state.lastBlob, state.lastMime, state.lastDuration);
});

loadConfig();
renderHistory();
