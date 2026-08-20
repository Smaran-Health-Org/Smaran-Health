// Shared, doctor-friendly display helpers for consultation statuses and dates.
// Used by server pages and client components alike (no React dependency).

export type ConsultationStatus =
  | "draft"
  | "recording"
  | "uploading"
  | "processing"
  | "draft_ready"
  | "approved"
  | "rejected"
  | "failed";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const CONSULTATION_STATUS_LABEL: Record<ConsultationStatus, string> = {
  draft: "Not started",
  recording: "Recording",
  uploading: "Uploading",
  processing: "Processing",
  draft_ready: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
};

export const CONSULTATION_STATUS_TONE: Record<ConsultationStatus, StatusTone> = {
  draft: "neutral",
  recording: "info",
  uploading: "info",
  processing: "info",
  draft_ready: "warning",
  approved: "success",
  rejected: "danger",
  failed: "danger",
};

export function consultationStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return CONSULTATION_STATUS_LABEL[status as ConsultationStatus] ?? status;
}

export function consultationStatusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return CONSULTATION_STATUS_TONE[status as ConsultationStatus] ?? "neutral";
}

// The clinic serves Indian doctors, so dates are shown in India Standard Time
// (UTC+5:30, no daylight saving). Pinning the timezone makes formatting
// deterministic: the server (Node) and the browser must produce identical
// strings, otherwise client components throw hydration mismatches.
const CLINIC_TIME_ZONE = "Asia/Kolkata";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// Numeric day/month/year parts in the clinic timezone. We assemble the string
// manually so locale/ICU differences between Node and the browser (e.g. "Sept"
// vs "Sep", or month/day ordering) can never leak into the rendered output.
const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLINIC_TIME_ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

function toDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(date.getTime()) ? null : date;
}

function ymdParts(date: Date): { day: string; month: string; year: string } {
  const parts = DATE_PARTS_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year") };
}

export function formatDate(iso: string | Date | null | undefined): string {
  const date = toDate(iso);
  if (!date) return "—";
  const { day, month, year } = ymdParts(date);
  return `${day} ${MONTHS_SHORT[Number(month) - 1] ?? month} ${year}`;
}

// "Today", "Yesterday", or a short date — for recent-activity lists. Day
// boundaries are computed in the clinic timezone so the server and client
// agree on what counts as "today".
export function formatRelativeDay(iso: string | Date | null | undefined): string {
  const date = toDate(iso);
  if (!date) return "—";

  const dayKey = (d: Date) => {
    const { day, month, year } = ymdParts(d);
    return `${year}-${month}-${day}`;
  };

  const now = new Date();
  if (dayKey(date) === dayKey(now)) return "Today";
  if (dayKey(date) === dayKey(new Date(now.getTime() - 86400000))) return "Yesterday";
  return formatDate(date);
}
