import { z } from "zod";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { PreconsultEvidenceSource } from "@/lib/preconsult/evidence-links";

export { preconsultEvidenceHref, preconsultEvidenceLabel, preconsultSourceTagLabel, type PreconsultEvidenceSource } from "@/lib/preconsult/evidence-links";

export const preconsultEvidenceSourceTypeSchema = z.enum([
  "document",
  "observation",
  "intake_statement",
  "delta",
  "state_version",
  "clinical_note",
]);

export type PreconsultEvidenceSourceType = z.infer<typeof preconsultEvidenceSourceTypeSchema>;

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

const deltaEvidenceReferenceSchema = z.array(z.object({
  observationId: z.string().uuid().nullable(),
  intakeStatementId: z.string().uuid().nullable(),
  itemIndex: z.number().int().nonnegative(),
  correctionId: z.string().uuid().nullable(),
}));

export function deltaEvidenceSources(detail: Record<string, unknown>): PreconsultEvidenceSource[] {
  const parsed = deltaEvidenceReferenceSchema.safeParse(detail.evidence);
  if (!parsed.success) return [];
  return parsed.data.flatMap<PreconsultEvidenceSource>((reference) => {
    if (reference.observationId) return [{ type: "observation" as const, id: reference.observationId, itemIndex: reference.itemIndex }];
    if (reference.intakeStatementId) return [{ type: "intake_statement" as const, id: reference.intakeStatementId, itemIndex: reference.itemIndex }];
    return [];
  });
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
