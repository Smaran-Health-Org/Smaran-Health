import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  CLINICAL_STATE_COMPARATOR_VERSION,
  compareExternalObservation,
  comparePatientMedicationStatement,
  comparePatientStatement,
  type ClinicalStateDomain,
  type ClinicalStateStatus,
  type ClinicalStateValue,
  type CurrentClinicalState,
} from "@/lib/clinical-state/comparator";

export type ConfirmedClinicalState = CurrentClinicalState & {
  confirmedAt: string;
  confirmationKind: "initial_doctor_confirmation" | "doctor_correction" | "accepted_delta";
  sourceClinicalNoteId: string | null;
};

export type ConfirmedClinicalStateSnapshot = {
  baselineEstablished: { medication: boolean; condition: boolean; allergy: boolean };
  current: ConfirmedClinicalState[];
};

export class ClinicalStateError extends Error {
  constructor(public readonly kind: "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable") {
    super("Clinical state operation failed");
  }
}

function mapRpcError(error: { code?: string; message?: string }): never {
  if (error.code === "42501") throw new ClinicalStateError("forbidden");
  if (error.code === "P0002") throw new ClinicalStateError("not_found");
  if (["40901", "23505"].includes(error.code ?? "")) throw new ClinicalStateError("conflict");
  if (["22023", "23514"].includes(error.code ?? "")) throw new ClinicalStateError("invalid");
  throw new ClinicalStateError("unavailable");
}

function toState(row: Record<string, unknown>): ConfirmedClinicalState {
  return {
    id: String(row.id),
    lineageId: String(row.lineage_id),
    domain: row.domain as ClinicalStateDomain,
    stateKey: String(row.state_key),
    value: row.value_json as ClinicalStateValue,
    stateStatus: row.state_status as ClinicalStateStatus,
    confirmedAt: String(row.confirmed_at),
    confirmationKind: row.confirmation_kind as ConfirmedClinicalState["confirmationKind"],
    sourceClinicalNoteId: typeof row.source_clinical_note_id === "string" ? row.source_clinical_note_id : null,
  };
}

export async function getConfirmedClinicalState(patientId: string): Promise<ConfirmedClinicalStateSnapshot> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("current_confirmed_clinical_state")
    .select("id, lineage_id, domain, state_key, value_json, state_status, confirmed_at, confirmation_kind, source_clinical_note_id")
    .eq("patient_id", patientId)
    .order("confirmed_at", { ascending: false });
  if (error) throw new ClinicalStateError("unavailable");
  const current = ((data ?? []) as Array<Record<string, unknown>>).map(toState);
  return {
    baselineEstablished: {
      medication: current.some((state) => state.domain === "medication"),
      condition: current.some((state) => state.domain === "condition"),
      allergy: current.some((state) => state.domain === "allergy"),
    },
    current,
  };
}

export async function createConfirmedClinicalState(input: {
  patientId: string;
  domain: ClinicalStateDomain;
  stateKey: string;
  value: ClinicalStateValue;
  stateStatus: ClinicalStateStatus;
  supersedesStateVersionId?: string | null;
  sourceClinicalNoteId?: string | null;
  idempotencyKey: string;
}) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_confirmed_clinical_state_version", {
    p_patient_id: input.patientId,
    p_domain: input.domain,
    p_state_key: input.stateKey,
    p_value_json: input.value,
    p_state_status: input.stateStatus,
    p_supersedes_state_version_id: input.supersedesStateVersionId ?? null,
    p_source_clinical_note_id: input.sourceClinicalNoteId ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) mapRpcError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ClinicalStateError("unavailable");
  return toState(row as Record<string, unknown>);
}

export async function decideClinicalStateDelta(input: {
  deltaId: string;
  action: "accept" | "keep_current";
  expectedBaseStateVersionId: string | null;
  idempotencyKey: string;
}) {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("decide_clinical_state_delta", {
    p_delta_id: input.deltaId,
    p_action: input.action,
    p_expected_base_state_version_id: input.expectedBaseStateVersionId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) mapRpcError(error);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new ClinicalStateError("unavailable");
  return {
    deltaId: String(row.delta_id),
    disposition: row.disposition as "accepted" | "kept_current" | "stale",
    resultingStateVersionId: typeof row.resulting_state_version_id === "string" ? row.resulting_state_version_id : null,
  };
}

/**
 * Best-effort, retryable reconciliation. It is intentionally called after a
 * source transaction has committed and callers must swallow failures.
 */
export async function reconcilePatientClinicalEvidence(patientId: string): Promise<void> {
  const service = createServiceRoleClient();
  const persistProposal = async (params: Record<string, unknown>) => {
    const { error } = await service.rpc("create_clinical_state_delta", params);
    if (error) throw new ClinicalStateError("unavailable");
  };
  const { data: stateRows, error: stateError } = await service
    .from("current_confirmed_clinical_state")
    .select("id, lineage_id, domain, state_key, value_json, state_status")
    .eq("patient_id", patientId);
  if (stateError) throw new ClinicalStateError("unavailable");
  const current = ((stateRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), lineageId: String(row.lineage_id), domain: row.domain as ClinicalStateDomain,
    stateKey: String(row.state_key), value: row.value_json as ClinicalStateValue,
    stateStatus: row.state_status as ClinicalStateStatus,
  }));

  const { data: observations, error: observationError } = await service
    .from("clinical_observation_trend_inputs")
    .select("id, observation_type, display_name, normalized_value")
    .eq("patient_id", patientId)
    .in("observation_type", ["medication", "condition", "allergy"]);
  if (observationError) throw new ClinicalStateError("unavailable");
  for (const row of (observations ?? []) as Array<Record<string, unknown>>) {
    const domain = row.observation_type as ClinicalStateDomain;
    const normalized = row.normalized_value as { valueText?: string };
    const value: ClinicalStateValue = {
      displayName: String(row.display_name),
      valueText: String(normalized.valueText ?? ""),
      ...(domain === "medication" ? { regimenText: String(normalized.valueText ?? "") } : {}),
    };
    const outcome = compareExternalObservation(domain, value, current);
    if (outcome.kind === "no_material_change") continue;
    await persistProposal({
      p_source_observation_id: row.id,
      p_source_intake_statement_id: null,
      p_source_item_index: 0,
      p_domain: domain,
      p_classification: outcome.kind,
      p_base_state_version_id: outcome.baseStateVersionId,
      p_target_lineage_id: outcome.targetLineageId,
      p_proposed_state_key: outcome.proposedStateKey,
      p_proposed_value_json: outcome.proposedValue,
      p_proposed_state_status: outcome.proposedStateStatus,
      p_comparator_contract_version: CLINICAL_STATE_COMPARATOR_VERSION,
      p_proposal_fingerprint: outcome.fingerprint,
    });
  }

  const { data: statements, error: statementError } = await service
    .from("patient_intake_statements")
    .select("id, self_reported_medications, self_reported_conditions, self_reported_allergies")
    .eq("patient_id", patientId);
  if (statementError) throw new ClinicalStateError("unavailable");
  for (const statement of (statements ?? []) as Array<Record<string, unknown>>) {
    const sourceId = String(statement.id);
    const groups: Array<[ClinicalStateDomain, unknown[]]> = [
      ["medication", Array.isArray(statement.self_reported_medications) ? statement.self_reported_medications : []],
      ["condition", Array.isArray(statement.self_reported_conditions) ? statement.self_reported_conditions : []],
      ["allergy", Array.isArray(statement.self_reported_allergies) ? statement.self_reported_allergies : []],
    ];
    for (const [domain, items] of groups) {
      for (const [index, item] of items.entries()) {
        if (typeof item !== "string") continue;
        const outcome = domain === "medication"
          ? comparePatientMedicationStatement(item, current)
          : comparePatientStatement(domain, item, current);
        if (outcome.kind === "no_material_change") continue;
        await persistProposal({
          p_source_observation_id: null,
          p_source_intake_statement_id: sourceId,
          p_source_item_index: index,
          p_domain: domain,
          p_classification: outcome.kind,
          p_base_state_version_id: outcome.baseStateVersionId,
          p_target_lineage_id: outcome.targetLineageId,
          p_proposed_state_key: outcome.proposedStateKey,
          p_proposed_value_json: outcome.proposedValue,
          p_proposed_state_status: outcome.proposedStateStatus,
          p_comparator_contract_version: CLINICAL_STATE_COMPARATOR_VERSION,
          p_proposal_fingerprint: outcome.fingerprint,
        });
      }
    }
  }
}

export async function reconcilePatientIntakeEvidence(patientIntakeId: string): Promise<void> {
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("patient_intakes")
    .select("patient_id")
    .eq("id", patientIntakeId)
    .maybeSingle();
  if (error || !data?.patient_id) throw new ClinicalStateError("unavailable");
  await reconcilePatientClinicalEvidence(data.patient_id);
}
