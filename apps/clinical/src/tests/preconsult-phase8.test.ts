import assert from "node:assert/strict";
import test from "node:test";
import {
  compareExternalObservation,
  comparePatientMedicationStatement,
  conservativeStateKey,
  type CurrentClinicalState,
} from "../lib/clinical-state/comparator";

const metformin: CurrentClinicalState = {
  id: "state-a", lineageId: "lineage-a", domain: "medication", stateKey: "metformin",
  value: { displayName: "Metformin", valueText: "500 mg BD", regimenText: "500 mg BD" }, stateStatus: "active",
};

test("exact medication and regimen match produces no reconciliation work", () => {
  assert.deepEqual(compareExternalObservation("medication", metformin.value, [metformin]), { kind: "no_material_change" });
});

test("an exact medication identity with another regimen is conservative regimen change", () => {
  const result = compareExternalObservation("medication", {
    displayName: "Metformin", valueText: "1000 mg BD", regimenText: "1000 mg BD",
  }, [metformin]);
  assert.equal(result.kind, "possible_regimen_change");
  assert.equal(result.baseStateVersionId, "state-a");
});

test("only documented exact stopped/not taking phrases can propose discontinuation", () => {
  assert.equal(comparePatientMedicationStatement("stopped Metformin", [metformin]).kind, "possible_discontinuation");
  assert.equal(comparePatientMedicationStatement("Metformin sometimes misses doses", [metformin]).kind, "possible_change");
});

test("medication omission, substitution, synonym and unit differences are never inferred", () => {
  assert.equal(compareExternalObservation("medication", {
    displayName: "Metformin XR", valueText: "1000 mg OD", regimenText: "1000 mg OD",
  }, [metformin]).kind, "possible_addition");
  assert.notEqual(conservativeStateKey("Metformin XR"), conservativeStateKey("Metformin"));
  assert.equal(compareExternalObservation("medication", {
    displayName: "Metformin", valueText: "0.5 g BD", regimenText: "0.5 g BD",
  }, [metformin]).kind, "possible_regimen_change");
});

test("conditions and allergies remain proposals rather than diagnoses or silent removals", () => {
  assert.equal(compareExternalObservation("condition", { displayName: "Hypertension", valueText: "Hypertension" }, []).kind, "possible_addition");
  assert.equal(compareExternalObservation("allergy", { displayName: "Penicillin", valueText: "Penicillin" }, []).kind, "possible_addition");
});
