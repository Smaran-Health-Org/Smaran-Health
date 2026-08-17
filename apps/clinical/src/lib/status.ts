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

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "Today", "Yesterday", or a short date — for recent-activity lists.
export function formatRelativeDay(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDate(date);
}
