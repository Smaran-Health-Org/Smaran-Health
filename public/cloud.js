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
  preJob: null,
  lastBlob: null,
  lastMime: "audio/webm",
  lastDuration: 0,
  busy: false,
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
  if (clean === "audio/mp4" || clean === "audio/x-m4a") return "m4a";
  if (clean === "audio/ogg" || clean === "audio/opus") return "ogg";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "audio/wav" || clean === "audio/x-wav") return "wav";
  return "webm";
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
  log("info", "config loaded", { hasKey: config.hasKey, runtime: config.runtime });
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

  state.preJob = null;
  const comparing = el("ab-compare").checked;
  if (el("pre-initiate").checked && !comparing) {
    el("level").textContent = "pre-initiating job…";
    try {
      const response = await fetch("/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings(), diarization: el("diarization").value === "1" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "initiate failed");
      state.preJob = { jobId: data.jobId, ms: data.ms };
      el("level").textContent = `job ready in ${fmtMs(data.ms)} — E2 cost already paid`;
      log("info", "pre-initiate (E2)", { jobId: data.jobId, ms: data.ms });
    } catch (error) {
      el("level").textContent = `pre-initiate failed: ${error.message}`;
      log("error", "pre-initiate failed", { message: error.message });
    }
  } else if (comparing) {
    log("info", "A/B mode: pre-initiate skipped", { reason: "two jobs, cannot reuse one" });
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
  el("clip-seconds").value = durationSec.toFixed(1);
  el("rerun-btn").disabled = false;
  log("info", "recording stopped", { seconds: Number(durationSec.toFixed(1)), bytes: blob.size });
  await runPipeline(blob, state.mimeType, durationSec);
  state.preJob = null;
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
    diarization: el("diarization").value === "1",
  };
}

function resolveDuration(fallback) {
  const typed = Number(el("clip-seconds").value);
  if (Number.isFinite(typed) && typed > 0) return typed;
  return fallback || null;
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
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "x-ms-blob-type": "BlockBlob" },
        body: blob,
      });
      const putMs = Math.round(performance.now() - putStartedAt);
      addStep(card, record, "batch.upload_put", put.ok, putMs, `${fmtKb(blob.size)} · direct to storage`);
      if (!put.ok) throw new Error(`upload rejected (${put.status})`);
      log("info", "batch.upload_put", { variant, ms: putMs, bytes: blob.size, cors: "allowed" });
    } catch (error) {
      const putMs = Math.round(performance.now() - putStartedAt);
      addStep(card, record, "batch.upload_put", false, putMs, "CORS blocked");
      log("error", "direct upload blocked", { variant, ms: putMs, message: String(error.message).slice(0, 160) });
      throw new Error(
        `Direct upload blocked (${error.message}). Sarvam's storage does not allow this origin — ` +
          `the deployment needs a chunked server proxy instead. This is the §7.11 answer.`
      );
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

// ── pipeline (single or A/B) ─────────────────────────────────────────────────

async function runPipeline(blob, mimeType, durationSec) {
  if (state.busy) return;
  state.busy = true;

  const host = el("run-panel");
  host.innerHTML = "";
  const label = el("label").value.trim();
  const comparing = el("ab-compare").checked;

  try {
    if (!comparing) {
      const card = createCard(host, label || "run");
      await runVariant({
        blob,
        mimeType,
        durationSec,
        diarization: el("diarization").value === "1",
        variant: "single",
        card,
        reuseJob: state.preJob,
      });
      state.preJob = null;
      return;
    }

    // Two jobs, same bytes, same moment. Running them concurrently removes the biggest
    // confounder in a sequential A/B: provider queue position drifting between runs.
    log("info", "A/B comparison started", { bytes: blob.size });
    el("ab-card").hidden = false;
    el("ab-summary").innerHTML = "";
    document.querySelector("#ab-table tbody").innerHTML = "";
    el("ab-transcripts").innerHTML = "";

    const onCard = createCard(host, `${label || "run"} — diarization ON`);
    const offCard = createCard(host, `${label || "run"} — diarization OFF`);

    const [on, off] = await Promise.all([
      runVariant({ blob, mimeType, durationSec, diarization: true, variant: "diar-on", card: onCard }),
      runVariant({ blob, mimeType, durationSec, diarization: false, variant: "diar-off", card: offCard }),
    ]);
    state.preJob = null;
    renderComparison(on, off);
  } finally {
    state.busy = false;
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
}

// ── history ──────────────────────────────────────────────────────────────────

function renderHistory() {
  const body = document.querySelector("#history tbody");
  body.innerHTML = "";
  for (const run of loadRuns()) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(run.at).toLocaleTimeString()}</td>
      <td>${escapeHtml(run.label || "—")}${run.variant && run.variant !== "single" ? ` <span class="muted">(${escapeHtml(run.variant)})</span>` : ""}</td>
      <td>${fmtSec(run.durationSec)}</td>
      <td>${fmtKb(run.audioBytes)}</td>
      <td>${escapeHtml(run.model)}${run.diarization ? "" : " · nodiar"}</td>
      <td>${fmtMs(run.totalMs)}</td>
      <td>${run.ratio ?? "—"}</td>
      <td>${fmtMs(run.providerWaitMs)}</td>
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
    detail.innerHTML = `<td colspan="9">${
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

function renderBenchmarks() {
  const all = loadRuns();
  const runs = all.filter((r) => r.status === "completed");
  const body = document.querySelector("#benchmarks tbody");
  body.innerHTML = "";

  const groups = BUCKETS.map((bucket) => ({
    label: bucket.label,
    runs: runs.filter((r) => Number.isFinite(r.durationSec) && bucket.test(r.durationSec)),
  }));
  const unknown = runs.filter((r) => !Number.isFinite(r.durationSec));
  if (unknown.length) groups.push({ label: "unknown length", runs: unknown });

  for (const group of groups) {
    if (group.runs.length === 0) continue;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${group.label}</td>
      <td>${group.runs.length}</td>
      <td>${fmtSec(median(group.runs.map((r) => r.durationSec)))}</td>
      <td>${fmtMs(median(group.runs.map((r) => r.totalMs)))}</td>
      <td>${median(group.runs.map((r) => r.ratio)) ?? "—"}</td>
      <td>${fmtMs(median(group.runs.map((r) => r.providerWaitMs)))}</td>
      <td>${fmtMs(median(group.runs.map((r) => r.overheadMs)))}</td>`;
    body.appendChild(row);
  }

  const summary = el("bench-summary");
  summary.innerHTML = "";
  const add = (text) => {
    const line = document.createElement("div");
    line.className = "note";
    line.textContent = text;
    summary.appendChild(line);
  };

  if (runs.length === 0) {
    add("No completed runs yet — record or upload a clip.");
    return;
  }
  add(`${runs.length} completed run(s). Overall median × ${median(runs.map((r) => r.ratio)) ?? "—"}.`);

  const withProvider = runs.filter((r) => r.providerWaitMs != null);
  if (withProvider.length) {
    add(
      `Median provider wait ${fmtMs(median(withProvider.map((r) => r.providerWaitMs)))}, ` +
        `median our overhead ${fmtMs(median(withProvider.map((r) => r.overheadMs)))}.`
    );
  }

  const onDiar = runs.filter((r) => r.diarization && r.providerWaitMs != null);
  const offDiar = runs.filter((r) => !r.diarization && r.providerWaitMs != null);
  if (onDiar.length && offDiar.length) {
    const a = median(onDiar.map((r) => r.providerWaitMs));
    const b = median(offDiar.map((r) => r.providerWaitMs));
    add(`Median provider wait: diarization on ${fmtMs(a)}, off ${fmtMs(b)} (delta ${fmtMs(a - b)}).`);
  }

  const failed = all.filter((r) => r.status !== "completed").length;
  if (failed) add(`${failed} failed run(s) not counted.`);
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
    "variant",
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
      r.variant ?? "",
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
  state.lastMime = file.type || "audio/webm";
  const probed = await probeDuration(file);
  state.lastDuration = probed ?? 0;
  el("clip-seconds").value = probed ? probed.toFixed(1) : "";
  el("rerun-btn").disabled = false;
  log("info", "file selected", { bytes: file.size, seconds: probed ?? "unknown", type: state.lastMime });
  await runPipeline(file, state.lastMime, state.lastDuration);
});

el("rerun-btn").addEventListener("click", async () => {
  if (!state.lastBlob) return;
  await runPipeline(state.lastBlob, state.lastMime, state.lastDuration);
});

loadConfig();
renderHistory();
renderBenchmarks();
renderLog();
