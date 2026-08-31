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

type ReconciliationWork = {
  id: string;
  patient_id: string;
  source_observation_id: string | null;
  source_intake_statement_id: string | null;
  source_item_index: number;
  domain: ClinicalStateDomain;
};

async function currentStateForWork(patientId: string) {
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("current_confirmed_clinical_state")
    .select("id, lineage_id, domain, state_key, value_json, state_status")
    .eq("patient_id", patientId);
  if (error) throw new ClinicalStateError("unavailable");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), lineageId: String(row.lineage_id), domain: row.domain as ClinicalStateDomain,
    stateKey: String(row.state_key), value: row.value_json as ClinicalStateValue,
    stateStatus: row.state_status as ClinicalStateStatus,
  }));
}

async function reconcileWorkItem(work: ReconciliationWork): Promise<void> {
  const service = createServiceRoleClient();
  const current = await currentStateForWork(work.patient_id);
  let outcome: ReturnType<typeof compareExternalObservation>;

  if (work.source_observation_id) {
    const { data, error } = await service
      .from("clinical_observations")
      .select("id, observation_type, display_name, normalized_value")
      .eq("id", work.source_observation_id)
      .maybeSingle();
    if (error || !data) throw new ClinicalStateError("unavailable");
    const row = data as Record<string, unknown>;
    const domain = row.observation_type as ClinicalStateDomain;
    if (domain !== work.domain) throw new ClinicalStateError("invalid");
    const normalized = row.normalized_value as { valueText?: string };
    const value: ClinicalStateValue = {
      displayName: String(row.display_name), valueText: String(normalized.valueText ?? ""),
      ...(domain === "medication" ? { regimenText: String(normalized.valueText ?? "") } : {}),
    };
    outcome = compareExternalObservation(domain, value, current);
  } else if (work.source_intake_statement_id) {
    const { data, error } = await service
      .from("patient_intake_statements")
      .select("self_reported_medications, self_reported_conditions, self_reported_allergies")
      .eq("id", work.source_intake_statement_id)
      .maybeSingle();
    if (error || !data) throw new ClinicalStateError("unavailable");
    const statement = data as Record<string, unknown>;
    const items = work.domain === "medication" ? statement.self_reported_medications
      : work.domain === "condition" ? statement.self_reported_conditions : statement.self_reported_allergies;
    const item = Array.isArray(items) ? items[work.source_item_index] : undefined;
    if (typeof item !== "string" || !item.trim()) throw new ClinicalStateError("invalid");
    outcome = work.domain === "medication"
      ? comparePatientMedicationStatement(item, current)
      : comparePatientStatement(work.domain, item, current);
  } else {
    throw new ClinicalStateError("invalid");
  }

  if (outcome.kind === "no_material_change") return;
  const { error } = await service.rpc("create_clinical_state_delta", {
    p_source_observation_id: work.source_observation_id,
    p_source_intake_statement_id: work.source_intake_statement_id,
    p_source_item_index: work.source_item_index,
    p_domain: work.domain,
    p_classification: outcome.kind,
    p_base_state_version_id: outcome.baseStateVersionId,
    p_target_lineage_id: outcome.targetLineageId,
    p_proposed_state_key: outcome.proposedStateKey,
    p_proposed_value_json: outcome.proposedValue,
    p_proposed_state_status: outcome.proposedStateStatus,
    p_comparator_contract_version: CLINICAL_STATE_COMPARATOR_VERSION,
    p_proposal_fingerprint: outcome.fingerprint,
  });
  if (error) throw new ClinicalStateError("unavailable");
}

/**
 * Drains durable, source-scoped reconciliation work. Source transactions create
 * the work row first, so a process termination can delay reconciliation but can
 * never erase the need to reconcile or affect intake/document success.
 */
export async function drainClinicalStateReconciliation(limit = 16): Promise<void> {
  const service = createServiceRoleClient();
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await service.rpc("claim_clinical_state_reconciliation_work");
    if (error) throw new ClinicalStateError("unavailable");
    const work = (Array.isArray(data) ? data[0] : data) as ReconciliationWork | null;
    if (!work) return;
    try {
      await reconcileWorkItem(work);
      const { error: completeError } = await service.rpc("complete_clinical_state_reconciliation_work", { p_work_id: work.id });
      if (completeError) throw new ClinicalStateError("unavailable");
    } catch {
      await service.rpc("fail_clinical_state_reconciliation_work", {
        p_work_id: work.id,
        p_failure_code: "reconciliation_failed",
      });
    }
  }
}
