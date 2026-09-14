import assert from "node:assert/strict";
import test from "node:test";
import { assertTransition, isLegalEdge, STATES, stateConsistencyIssues } from "../src/state.js";
import { syntheticState } from "./helpers.js";

const checks = { authority: "orchestrator" as const, inputsUnchanged: true, refinementApprovalVerified: true, planningResultValidated: true, planApprovalVerified: true };

test("only the four forward edges are legal; all other pairs fail closed", () => {
  for (const from of STATES) for (const to of STATES) {
    const legal = STATES.indexOf(to) === STATES.indexOf(from) + 1;
    assert.equal(isLegalEdge(from, to), legal, `${from} -> ${to}`);
    if (legal) assert.doesNotThrow(() => assertTransition(from, to, checks));
    else assert.throws(() => assertTransition(from, to, checks));
  }
});

test("unknown states and unsupported implementation/review states are rejected", () => {
  for (const unknown of ["implementing", "reviewing", "closed", "unknown", null, 1]) {
    assert.equal(isLegalEdge("plan_approved", unknown), false);
    assert.equal(isLegalEdge(unknown, "planning"), false);
    assert.throws(() => assertTransition("plan_approved", unknown, checks));
  }
});

test("legal topology and schema-valid state do not authorize advancement", () => {
  assert.throws(() => assertTransition("refinement_pending", "refinement_approved", { authority: "orchestrator", inputsUnchanged: true }));
  assert.throws(() => assertTransition("refinement_approved", "planning", { ...checks, inputsUnchanged: false }));
  assert.throws(() => assertTransition("planning", "plan_ready", { ...checks, planningResultValidated: false }));
  assert.throws(() => assertTransition("plan_ready", "plan_approved", { ...checks, planApprovalVerified: false }));
  assert.throws(() => assertTransition("refinement_approved", "planning", { ...checks, authority: "agent" } as unknown as typeof checks));
});

test("all supported states have locally consistent synthetic representations", () => {
  for (const state of STATES) assert.deepEqual(stateConsistencyIssues(syntheticState(state)), [], state);
});

test("approved refinement requires matching hashes, pinned commits and positive revision", () => {
  const state = syntheticState("refinement_approved");
  delete state.repository.source_commit;
  delete state.artifacts.brief.sha256;
  state.revision = 0;
  const issues = stateConsistencyIssues(state).join(" ");
  assert.match(issues, /source_commit/);
  assert.match(issues, /brief SHA-256/);
  assert.match(issues, /positive revision/);
  assert.match(issues, /bind the recorded artifact hash/);
});

test("planning and plan_ready require state-dependent provenance and artifacts", () => {
  const state = syntheticState("plan_ready");
  delete state.provenance;
  delete state.artifacts.context;
  delete state.artifacts.plan;
  const issues = stateConsistencyIssues(state).join(" ");
  assert.match(issues, /run_id and input_commit/);
  assert.match(issues, /context artifact/);
  assert.match(issues, /plan artifact/);
});

test("invalidated or prematurely approved gates block the recorded state", () => {
  const state = syntheticState("refinement_approved");
  state.gates.refinement = { status: "invalidated", invalidation_reason: "Synthetic changed input" };
  assert.match(stateConsistencyIssues(state).join(" "), /invalidated/);
  state.gates.plan = syntheticState("plan_approved").gates.plan;
  assert.match(stateConsistencyIssues(state).join(" "), /plan gate must be pending/);
});

test("transition bookkeeping cannot describe a skipped gate or a different current state", () => {
  const state = syntheticState("plan_ready");
  state.last_transition = { from: "refinement_pending", to: "plan_approved", at: "2026-09-14T00:00:00Z", actor: "synthetic-orchestrator" };
  assert.match(stateConsistencyIssues(state).join(" "), /last_transition/);
});
