import { createHash } from "node:crypto";

export const CLINICAL_STATE_COMPARATOR_VERSION = "preconsult-phase8/v1";
export type ClinicalStateDomain = "medication" | "condition" | "allergy";
export type ClinicalStateStatus = "active" | "inactive";
export type ClinicalStateValue = { displayName: string; valueText: string; regimenText?: string };
export type CurrentClinicalState = {
  id: string;
  lineageId: string;
  domain: ClinicalStateDomain;
  stateKey: string;
  value: ClinicalStateValue;
  stateStatus: ClinicalStateStatus;
};
export type ComparatorOutcome =
  | { kind: "no_material_change" }
  | {
    kind: "possible_addition" | "possible_discontinuation" | "possible_regimen_change" | "possible_status_change" | "possible_removal" | "possible_change";
    baseStateVersionId: string | null;
    targetLineageId: string | null;
    proposedStateKey: string;
    proposedValue: ClinicalStateValue;
    proposedStateStatus: ClinicalStateStatus;
    fingerprint: string;
  };

function canonical(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/\s+/g, " ").trim();
}

export function conservativeStateKey(value: string): string {
  return canonical(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function equalValue(left: ClinicalStateValue, right: ClinicalStateValue, medication: boolean): boolean {
  return canonical(left.displayName) === canonical(right.displayName)
    && canonical(left.valueText) === canonical(right.valueText)
    && (!medication || canonical(left.regimenText ?? "") === canonical(right.regimenText ?? ""));
}

function fingerprint(domain: ClinicalStateDomain, baseId: string | null, classification: string, key: string, value: ClinicalStateValue): string {
  return createHash("sha256").update(JSON.stringify({
    version: CLINICAL_STATE_COMPARATOR_VERSION,
    domain,
    baseId,
    classification,
    key: canonical(key),
    displayName: canonical(value.displayName),
    valueText: canonical(value.valueText),
    regimenText: canonical(value.regimenText ?? ""),
  })).digest("hex");
}

function proposal(
  kind: Exclude<ComparatorOutcome["kind"], "no_material_change">,
  domain: ClinicalStateDomain,
  state: CurrentClinicalState | null,
  value: ClinicalStateValue,
  status: ClinicalStateStatus = "active"
): ComparatorOutcome {
  const key = conservativeStateKey(value.displayName);
  return {
    kind,
    baseStateVersionId: state?.id ?? null,
    targetLineageId: state?.lineageId ?? null,
    proposedStateKey: key,
    proposedValue: value,
    proposedStateStatus: status,
    fingerprint: fingerprint(domain, state?.id ?? null, kind, key, value),
  };
}

/** Exact textual matching only; this intentionally makes ambiguity visible. */
export function compareExternalObservation(
  domain: ClinicalStateDomain,
  value: ClinicalStateValue,
  current: CurrentClinicalState[]
): ComparatorOutcome {
  const key = conservativeStateKey(value.displayName);
  const matches = current.filter((state) => state.domain === domain && state.stateStatus === "active" && state.stateKey === key);

  if (matches.length === 1 && equalValue(matches[0].value, value, domain === "medication")) {
    return { kind: "no_material_change" };
  }
  if (matches.length > 1) return proposal("possible_change", domain, null, value);
  if (domain === "medication" && matches.length === 1) return proposal("possible_regimen_change", domain, matches[0], value);
  if ((domain === "condition" || domain === "allergy") && matches.length === 1) {
    return proposal("possible_status_change", domain, matches[0], value);
  }
  return proposal("possible_addition", domain, null, value);
}

// The narrow, documented Phase 8 patient-use contract. It deliberately does
// not attempt multilingual or clinical/NLP interpretation.
const STOP_PREFIX = /^(?:stopped|not taking|not using|discontinued)\s+(.+)$/iu;

export function comparePatientMedicationStatement(
  statement: string,
  current: CurrentClinicalState[]
): ComparatorOutcome {
  const trimmed = statement.trim();
  const stopped = trimmed.match(STOP_PREFIX);
  if (stopped) {
    const key = conservativeStateKey(stopped[1]);
    const matches = current.filter((state) => state.domain === "medication" && state.stateStatus === "active" && state.stateKey === key);
    if (matches.length === 1) {
      return proposal("possible_discontinuation", "medication", matches[0], {
        displayName: matches[0].value.displayName,
        valueText: trimmed,
        regimenText: trimmed,
      }, "inactive");
    }
  }
  return proposal("possible_change", "medication", null, {
    displayName: trimmed,
    valueText: trimmed,
    regimenText: trimmed,
  });
}

export function comparePatientStatement(
  domain: Exclude<ClinicalStateDomain, "medication">,
  statement: string,
  current: CurrentClinicalState[]
): ComparatorOutcome {
  return compareExternalObservation(domain, { displayName: statement.trim(), valueText: statement.trim() }, current);
}
