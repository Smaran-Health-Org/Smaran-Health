import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export type PatientMergeResult = {
  id: string;
  clinicId: string;
  sourcePatientId: string;
  canonicalPatientId: string;
  mergedBy: string;
  reason: "confirmed_duplicate";
  createdAt: string;
};

export class PatientMergeError extends Error {
  constructor(
    public readonly kind: "forbidden" | "not_found" | "conflict" | "unknown",
    message: string
  ) {
    super(message);
    this.name = "PatientMergeError";
  }
}

function classifyMergeError(message: string): PatientMergeError {
  if (
    message.includes("Doctor or admin role required") ||
    message.includes("not authorized for this role")
  ) {
    return new PatientMergeError("forbidden", "Only doctors and clinic admins may merge patients");
  }
  if (message.includes("not found in clinic")) {
    return new PatientMergeError("not_found", "Patient not found");
  }
  if (
    message.includes("cannot be merged") ||
    message.includes("must be different") ||
    message.includes("Unsupported merge reason")
  ) {
    return new PatientMergeError("conflict", message);
  }
  return new PatientMergeError("unknown", "Patient merge failed");
}

export async function mergePatientsWithClient(
  supabase: SupabaseClient,
  sourcePatientId: string,
  canonicalPatientId: string,
  reason: "confirmed_duplicate"
): Promise<PatientMergeResult> {
  const { data, error } = await supabase.rpc("merge_patients", {
    p_source_patient_id: sourcePatientId,
    p_canonical_patient_id: canonicalPatientId,
    p_reason: reason,
  });

  if (error) throw classifyMergeError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PatientMergeError("unknown", "Patient merge returned no result");

  return {
    id: row.id,
    clinicId: row.clinic_id,
    sourcePatientId: row.source_patient_id,
    canonicalPatientId: row.canonical_patient_id,
    mergedBy: row.merged_by,
    reason: row.reason,
    createdAt: row.created_at,
  } as PatientMergeResult;
}

export async function mergePatients(
  sourcePatientId: string,
  canonicalPatientId: string,
  reason: "confirmed_duplicate"
): Promise<PatientMergeResult> {
  const supabase = await createServerClient();
  return mergePatientsWithClient(supabase, sourcePatientId, canonicalPatientId, reason);
}
