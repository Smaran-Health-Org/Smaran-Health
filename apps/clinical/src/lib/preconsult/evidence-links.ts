import type { PreconsultBrief } from "@/lib/preconsult/contract";

export type PreconsultEvidenceSource = PreconsultBrief["evidenceSummary"][number];

export function preconsultEvidenceHref(patientId: string, source: PreconsultEvidenceSource) {
  if (source.type === "document") {
    const page = typeof source.page === "number" ? `?page=${source.page}` : "";
    return `/api/documents/${source.id}/view${page}`;
  }
  const query = new URLSearchParams({ type: source.type, source: source.id });
  if (typeof source.page === "number") query.set("page", String(source.page));
  if (typeof source.itemIndex === "number") query.set("item", String(source.itemIndex));
  return `/patients/${patientId}/preconsult/evidence?${query.toString()}`;
}

export function preconsultEvidenceLabel(source: PreconsultEvidenceSource) {
  if (source.type === "document") return "View original evidence";
  if (source.type === "clinical_note") return "Open approved note";
  if (source.type === "intake_statement") return "Open patient statement";
  if (source.type === "observation") return "Open source observation";
  if (source.type === "delta") return "Open proposed change source";
  return "Open confirmed-state source";
}
