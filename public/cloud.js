/**
 * Cloud (Vercel) UI for the Sarvam probe.
 *
 * A serverless function cannot hold a run, so this page drives the state machine itself
 * — initiate → presign → PUT → start → poll → download — and measures every hop with
 * `performance.now()`.
 *
 * Two rules this file keeps:
 *   • The upload goes straight from the browser to Sarvam's presigned storage URL. That
 *     stays under Vercel's 4.5 MB body limit and doubles as the CORS probe (§7.11).
 *   • The log and the run history hold timings, sizes and ids — **never** transcript text
 *     and never audio. Benchmarking must not become a PHI leak.
 */

const el = (id) => document.getElementById(id);

const RUNS_KEY = "sarvam-probe-runs";
const LOGS_KEY = "sarvam-probe-logs";
const MAX_LOGS = 500;

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

function writeLog(entries) {
  localStorage.setItem(LOGS_KEY, JSON.stringify(entries.slice(-MAX_LOGS)));
}

/**
 * Append one event. `extra` must contain only non-clinical values (ids, counts, ms).
 * Transcript text is deliberately never passed here.
 */
function log(level, message, extra) {
  const entry = { t: new Date().toISOString(), level, message, ...(extra ? { extra } : {}) };
  const entries = readLog();
  entries.push(entry);
  writeLog(entries.slice(-MAX_LOGS));
  renderLog();
  return entry;
}

function renderLog() {
  const box = el("log");
  if (!box) return;
  const entries = readLog().slice(-120).reverse();
  box.innerHTML = "";
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `step ${entry.level === "error" ? "failed" : ""}`;
    const time = new Date(entry.t).toLocaleTimeString();
    const extra = entry.extra
      ? ` ${Object.entries(entry.extra)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : "";
    row.innerHTML = `<span class="name">${escapeHtml(time)}</span><span class="ms">${escapeHtml(
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
      log("info", "pre-initiate (E2)", { jobId: data.jobId, ms: data.ms });
    } catch (error) {
      el("level").textContent = `pre-initiate failed: ${error.message}`;
      log("error", "pre-initiate failed", { message: error.message });
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
  el("clip-seconds").value = durationSec.toFixed(1);
  el("rerun-btn").disabled = false;
  log("info", "recording stopped", {
    seconds: Number(durationSec.toFixed(1)),
    bytes: blob.size,
  });
  await runPipeline(blob, state.mimeType, durationSec);
  state.preJob = null;
}

/** Read duration from the container's metadata — works for uploaded files. */
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

// ── run panel ────────────────────────────────────────────────────────────────

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

function addStep(panel, record, name, ok, durationMs, detail) {
  const row = document.createElement("div");
  row.className = `step ${ok ? "" : "failed"}`;
  row.innerHTML = `<span class="name">${escapeHtml(name)}</span><span class="ms">${fmtMs(
    durationMs
  )}</span><span class="detail">${escapeHtml(detail ?? "")}</span>`;
  panel.steps.appendChild(row);
  record.steps.push({ name, ok, ms: durationMs ?? null, at: new Date().toISOString(), detail: detail ?? null });
}

function note(panel, text, bad = false) {
  const line = document.createElement("div");
  line.className = "note";
  if (bad) line.style.color = "var(--bad)";
  line.textContent = text;
  panel.notes.appendChild(line);
}

async function jsonStep(panel, record, name, url, options) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  const ms = Math.round(performance.now() - startedAt);
  addStep(panel, record, name, response.ok, data.ms ?? ms, data.error ?? "");
  if (response.ok) log("info", name, { ms: data.ms ?? ms });
  else log("error", name, { status: response.status, message: String(data.error || "").slice(0, 160) });
  if (!response.ok) throw new Error(data.error || `${name} failed (${response.status})`);
  return data;
}

// ── pipeline ─────────────────────────────────────────────────────────────────

async function runPipeline(blob, mimeType, durationSec) {
  if (state.busy) return;
  state.busy = true;

  const panel = newPanel();
  const t0 = performance.now();
  const record = {
    at: new Date().toISOString(),
    label: el("label").value.trim(),
    durationSec: resolveDuration(durationSec),
    audioBytes: blob.size,
    mimeType,
    model: el("model").value,
    mode: el("mode").value,
    diarization: el("diarization").value === "1",
    preInitiated: Boolean(state.preJob),
    status: "running",
    totalMs: null,
    providerWaitMs: null,
    probeCount: null,
    jobId: null,
    steps: [],
  };

  log("info", "run started", {
    bytes: blob.size,
    seconds: record.durationSec ?? "?",
    model: record.model,
  });

  try {
    // 1. Job — already initiated during recording, or initiate now.
    let jobId;
    if (state.preJob) {
      jobId = state.preJob.jobId;
      addStep(panel, record, "batch.initiate", true, 0, "pre-initiated during recording (E2)");
    } else {
      const job = await jsonStep(panel, record, "batch.initiate", "/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings()),
      });
      jobId = job.jobId;
    }
    record.jobId = jobId;

    // 2. Presigned URL for this one file.
    const fileName = `part-1.${extForMime(mimeType)}`;
    const presign = await jsonStep(panel, record, "batch.upload_url", "/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, files: [fileName] }),
    });
    const uploadUrl = presign.files[fileName];
    if (!uploadUrl) throw new Error("No presigned upload URL returned.");

    // 3. Direct browser → Sarvam storage. Also the CORS probe (§7.11).
    const putStartedAt = performance.now();
    try {
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "x-ms-blob-type": "BlockBlob" },
        body: blob,
      });
      const putMs = Math.round(performance.now() - putStartedAt);
      addStep(panel, record, "batch.upload_put", put.ok, putMs, `${fmtKb(blob.size)} · direct to storage`);
      if (!put.ok) throw new Error(`upload rejected (${put.status})`);
      log("info", "batch.upload_put", { ms: putMs, bytes: blob.size, cors: "allowed" });
      note(panel, "Direct browser upload worked — Sarvam's storage allows this origin (CORS ok).");
    } catch (error) {
      const putMs = Math.round(performance.now() - putStartedAt);
      addStep(panel, record, "batch.upload_put", false, putMs, "CORS blocked");
      log("error", "direct upload blocked", { ms: putMs, message: String(error.message).slice(0, 160) });
      throw new Error(
        `Direct upload blocked (${error.message}). Sarvam's storage does not allow this origin — ` +
          `the deployment needs a chunked server proxy instead. This is the §7.11 answer.`
      );
    }

    // 4. Start.
    await jsonStep(panel, record, "batch.start", "/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    // 5. Poll — the browser owns this loop; no function is held open.
    const pollMs = Math.max(500, Number(el("poll-ms").value) || 2000);
    const deadline = Date.now() + 15 * 60 * 1000;
    const waitStartedAt = performance.now();
    let probes = 0;
    let status;
    for (;;) {
      status = await jsonStep(panel, record, `batch.status#${++probes}`, `/api/status?jobId=${encodeURIComponent(jobId)}`, {
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
    note(
      panel,
      `Provider wait: ${(record.providerWaitMs / 1000).toFixed(1)} s over ${probes} probe(s).`
    );
    log("info", "job completed", { providerWaitMs: record.providerWaitMs, probes });

    // 6. Transcript.
    const result = await jsonStep(panel, record, "batch.download", "/api/download", {
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

    record.status = "completed";
    record.transcriptChars = (result.transcript || "").length;
    record.turnCount = result.turns?.length ?? 0;
    log("info", "run completed", {
      chars: record.transcriptChars,
      turns: record.turnCount,
      language: result.languageCode ?? "?",
    });
  } catch (error) {
    record.status = "failed";
    record.error = error.message;
    log("error", "run failed", { message: String(error.message).slice(0, 200) });
  } finally {
    record.totalMs = Math.round(performance.now() - t0);
    record.ratio =
      record.durationSec && record.totalMs
        ? Number((record.totalMs / 1000 / record.durationSec).toFixed(2))
        : null;
    record.overheadMs =
      record.providerWaitMs != null ? Math.max(0, record.totalMs - record.providerWaitMs) : null;

    if (record.status === "completed") {
      panel.total.textContent = `${fmtMs(record.totalMs)}${record.ratio ? ` · ×${record.ratio}` : ""}`;
    } else {
      panel.total.textContent = "failed";
      panel.total.classList.add("bad");
      note(panel, record.error || "Run failed.", true);
    }

    state.busy = false;
    saveRun(record);
    renderHistory();
    renderBenchmarks();
  }
}

// ── storage ──────────────────────────────────────────────────────────────────

function loadRuns() {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRun(record) {
  const runs = loadRuns();
  runs.unshift(record);
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
      <td>${escapeHtml(run.label || "—")}</td>
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
  const runs = loadRuns().filter((r) => r.status === "completed");
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
    const provider = median(withProvider.map((r) => r.providerWaitMs));
    const overhead = median(withProvider.map((r) => r.overheadMs));
    add(`Median provider wait ${fmtMs(provider)}, median our overhead ${fmtMs(overhead)}.`);
  }
  const failed = loadRuns().filter((r) => r.status !== "completed").length;
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

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

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
    "status",
    "error",
  ];
  const rows = loadRuns().map((r) =>
    [
      r.at,
      r.label ?? "",
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
