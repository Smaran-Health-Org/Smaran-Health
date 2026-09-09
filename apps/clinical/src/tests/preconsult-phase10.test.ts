import assert from "node:assert/strict";
import test from "node:test";
import { applyClinicalStateDeltaBatchSchema } from "../lib/validation";
import { clinicalStateReviewCommandIdentity, clinicalStateReviewComparisonIsActionable, clinicalStateReviewComparisonPresentation, clinicalStateReviewComparisons, MAX_REVIEW_BATCH_SIZE, remainingClinicalStateReviewDeltas } from "../lib/clinical-state/review-command";

const deltaA = "00000000-0000-4000-8000-000000000001";
const deltaB = "00000000-0000-4000-8000-000000000002";
const baseA = "00000000-0000-4000-8000-000000000003";

function decision(deltaId: string, action: "accept" | "keep_current", base: string | null = baseA) {
  return { deltaId, action, expectedBaseStateVersionId: base, expectedEffectiveSourceRevision: "original" };
}

test("Phase 10 batch contract permits mixed doctor choices without client-side mutation fields", () => {
  const parsed = applyClinicalStateDeltaBatchSchema.safeParse({
    idempotencyKey: "review-command-1",
    decisions: [decision(deltaA, "accept"), decision(deltaB, "keep_current", null)],
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(Object.keys(parsed.data.decisions[0]).sort(), ["action", "deltaId", "expectedBaseStateVersionId", "expectedEffectiveSourceRevision"]);
});

test("Phase 10 rejects duplicate delta decisions before the batch can reach clinical authority", () => {
  const parsed = applyClinicalStateDeltaBatchSchema.safeParse({
    idempotencyKey: "review-command-2",
    decisions: [decision(deltaA, "accept"), decision(deltaA, "keep_current")],
  });
  assert.equal(parsed.success, false);
});

test("Phase 10 requires the viewed source revision and base token for every staged decision", () => {
  assert.equal(applyClinicalStateDeltaBatchSchema.safeParse({ idempotencyKey: "review-command-3", decisions: [{ deltaId: deltaA, action: "accept", expectedBaseStateVersionId: baseA }] }).success, false);
  assert.equal(applyClinicalStateDeltaBatchSchema.safeParse({ idempotencyKey: "review-command-4", decisions: [decision(deltaA, "accept", "not-a-uuid")] }).success, false);
});

test("Phase 10 reuses one command identity across harmless ordering changes", () => {
  assert.equal(
    clinicalStateReviewCommandIdentity([decision(deltaA, "accept"), decision(deltaB, "keep_current", null)]),
    clinicalStateReviewCommandIdentity([decision(deltaB, "keep_current", null), decision(deltaA, "accept")]),
  );
  assert.notEqual(clinicalStateReviewCommandIdentity([decision(deltaA, "accept")]), clinicalStateReviewCommandIdentity([decision(deltaA, "keep_current")]));
});

test("Phase 10 partial apply keeps every unsubmitted delta available", () => {
  assert.deepEqual(remainingClinicalStateReviewDeltas([{ id: deltaA }, { id: deltaB }], new Set([deltaA])), [{ id: deltaB }]);
  assert.equal(MAX_REVIEW_BATCH_SIZE, 50);
});

const currentValue = { displayName: "Confirmed item", valueText: "Current value" };
const reviewDelta = (overrides: Partial<{ id: string; baseStateVersionId: string | null; proposedStateKey: string }> = {}) => ({
  id: overrides.id ?? deltaA,
  domain: "condition" as const,
  baseStateVersionId: overrides.baseStateVersionId === undefined ? baseA : overrides.baseStateVersionId,
  proposedStateKey: overrides.proposedStateKey ?? "confirmed-item",
});

test("Phase 10 fails closed when the confirmed-state query is unavailable", () => {
  const comparisons = clinicalStateReviewComparisons([reviewDelta()], { status: "unavailable" });
  assert.deepEqual(comparisons[deltaA], { status: "refresh_required" });
  assert.equal(clinicalStateReviewComparisonIsActionable(comparisons[deltaA]), false);
  const presentation = clinicalStateReviewComparisonPresentation(comparisons[deltaA]);
  assert.equal(presentation.currentRecord, "This change could not be refreshed");
  assert.notEqual(presentation.currentRecord, "No current confirmed item");
  assert.equal(presentation.actionable, false);
});

test("Phase 10 requires refresh when a non-null base is absent from current state", () => {
  const comparisons = clinicalStateReviewComparisons([reviewDelta()], { status: "available", current: [] });
  assert.deepEqual(comparisons[deltaA], { status: "refresh_required" });
});

test("Phase 10 presents a confirmed-empty null-base proposal only after a successful empty same-key lookup", () => {
  const comparisons = clinicalStateReviewComparisons([reviewDelta({ baseStateVersionId: null })], { status: "available", current: [] });
  assert.deepEqual(comparisons[deltaA], { status: "ready", current: "addition" });
  assert.equal(clinicalStateReviewComparisonPresentation(comparisons[deltaA]).currentRecord, "Not currently in confirmed state");
});

test("Phase 10 requires refresh when a null-base proposal now has current same-key state", () => {
  const comparisons = clinicalStateReviewComparisons([reviewDelta({ baseStateVersionId: null })], {
    status: "available",
    current: [{ id: baseA, domain: "condition", stateKey: "confirmed-item", value: currentValue }],
  });
  assert.deepEqual(comparisons[deltaA], { status: "refresh_required" });
});

test("Phase 10 preserves safe comparisons while excluding an invalid comparison from staging", () => {
  const comparisons = clinicalStateReviewComparisons([reviewDelta(), reviewDelta({ id: deltaB, baseStateVersionId: "00000000-0000-4000-8000-000000000004", proposedStateKey: "new-item" })], {
    status: "available",
    current: [{ id: baseA, domain: "condition", stateKey: "confirmed-item", value: currentValue }],
  });
  assert.deepEqual(comparisons[deltaA], { status: "ready", current: "base", value: currentValue });
  assert.deepEqual(comparisons[deltaB], { status: "refresh_required" });
  assert.equal(clinicalStateReviewComparisonIsActionable(comparisons[deltaA]), true);
  assert.equal(clinicalStateReviewComparisonIsActionable(comparisons[deltaB]), false);
});
