// Structured, PHI-safe logging for server code (Route Handlers / Server
// Components). Output is single-line JSON so Vercel function logs are
// grep-able. Only internal IDs and metadata are logged — NEVER patient names,
// transcripts, clinical notes, medication details, diagnoses, or audio URLs
// (per AGENTS.md §11).

type LogFields = Record<string, unknown>;

export function logEvent(event: string, fields?: LogFields): void {
  console.log(
    JSON.stringify({
      level: "info",
      event,
      ts: new Date().toISOString(),
      ...(fields ?? {}),
    })
  );
}

export function logWarn(event: string, fields?: LogFields): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event,
      ts: new Date().toISOString(),
      ...(fields ?? {}),
    })
  );
}

export function logError(event: string, error: unknown, fields?: LogFields): void {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      ts: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      ...(fields ?? {}),
    })
  );
}
