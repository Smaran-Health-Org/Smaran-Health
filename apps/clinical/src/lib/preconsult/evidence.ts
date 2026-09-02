import { z } from "zod";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { PreconsultBrief } from "@/lib/preconsult/contract";

export const preconsultEvidenceSourceTypeSchema = z.enum([
  "document",
  "observation",
  "intake_statement",
  "delta",
  "state_version",
  "clinical_note",
]);

export type PreconsultEvidenceSourceType = z.infer<typeof preconsultEvidenceSourceTypeSchema>;
export type PreconsultEvidenceSource = PreconsultBrief["evidenceSummary"][number];

const preconsultEvidenceRecordSchema = z.object({
  sourceType: preconsultEvidenceSourceTypeSchema,
  sourceId: z.string().uuid(),
  patientId: z.string().uuid(),
  title: z.string().min(1),
  verification: z.string().min(1),
  detail: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
});

export type PreconsultEvidenceRecord = z.infer<typeof preconsultEvidenceRecordSchema>;

export function preconsultEvidenceHref(patientId: string, source: PreconsultEvidenceSource) {
  if (source.type === "document") {
    const page = typeof source.page === "number" ? `?page=${source.page}` : "";
    return `/api/documents/${source.id}/view${page}`;
  }
  const query = new URLSearchParams({ type: source.type, source: source.id });
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

export async function getPreconsultEvidenceSource(
  patientId: string,
  sourceType: PreconsultEvidenceSourceType,
  sourceId: string,
) {
  const client = await createServerClient();
  const { data, error } = await client.rpc("get_preconsult_evidence_source", {
    p_patient_id: patientId,
    p_source_type: sourceType,
    p_source_id: sourceId,
  });
  if (error) throw new Error("preconsult_evidence_unavailable");
  return preconsultEvidenceRecordSchema.parse(data);
}
