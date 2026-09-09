import type { ClinicalStateDomain, ClinicalStateValue } from "@/lib/clinical-state/comparator";

export const MAX_REVIEW_BATCH_SIZE = 50;

export type ClinicalStateReviewDecision = {
  deltaId: string;
  action: "accept" | "keep_current";
  expectedBaseStateVersionId: string | null;
  expectedEffectiveSourceRevision: string;
};

/** Stable identity for reusing an idempotency key after an ambiguous retry. */
export function clinicalStateReviewCommandIdentity(decisions: ClinicalStateReviewDecision[]) {
  return JSON.stringify([...decisions].sort((left, right) => left.deltaId.localeCompare(right.deltaId)));
}

export function remainingClinicalStateReviewDeltas<T extends { id: string }>(deltas: T[], locallyResolvedIds: ReadonlySet<string>) {
  return deltas.filter((delta) => !locallyResolvedIds.has(delta.id));
}

export type CurrentClinicalStateForReview = {
  id: string;
  domain: ClinicalStateDomain;
  stateKey: string;
  value: ClinicalStateValue;
};

/**
 * A read failure is deliberately distinct from an empty confirmed-state list:
 * empty can establish an addition, while a failure cannot establish anything.
 */
export type CurrentClinicalStateForReviewRead =
  | { status: "available"; current: CurrentClinicalStateForReview[] }
  | { status: "unavailable" };

export type ClinicalStateReviewComparison =
  | { status: "ready"; current: "base"; value: ClinicalStateValue }
  | { status: "ready"; current: "addition" }
  | { status: "refresh_required" };

export const REVIEW_CHANGES_REFRESH_REQUIRED_TEXT = "This change could not be refreshed";
export const REVIEW_CHANGES_ADDITION_TEXT = "Not currently in confirmed state";

export function clinicalStateReviewComparisonIsActionable(comparison: ClinicalStateReviewComparison | undefined): boolean {
  return comparison?.status === "ready";
}

/** The exact comparison presentation shared by the UI and regression tests. */
export function clinicalStateReviewComparisonPresentation(comparison: ClinicalStateReviewComparison | undefined) {
  if (!comparison || comparison.status === "refresh_required") {
    return { actionable: false, currentRecord: REVIEW_CHANGES_REFRESH_REQUIRED_TEXT } as const;
  }
  if (comparison.current === "addition") {
    return { actionable: true, currentRecord: REVIEW_CHANGES_ADDITION_TEXT } as const;
  }
  return { actionable: true, currentRecord: comparison.value } as const;
}

type ReviewComparisonDelta = {
  id: string;
  domain: ClinicalStateDomain;
  baseStateVersionId: string | null;
  proposedStateKey: string;
};

/**
 * Makes the presentation boundary conservative before a decision reaches the
 * authoritative Apply RPC. A missing expected base and a newly-present
 * same-key record are stale comparisons, never additions.
 */
export function clinicalStateReviewComparisons(
  deltas: ReviewComparisonDelta[],
  currentState: CurrentClinicalStateForReviewRead,
): Record<string, ClinicalStateReviewComparison> {
  if (currentState.status === "unavailable") {
    return Object.fromEntries(deltas.map((delta) => [delta.id, { status: "refresh_required" }])) as Record<string, ClinicalStateReviewComparison>;
  }

  const byId = new Map(currentState.current.map((state) => [state.id, state]));
  return Object.fromEntries(deltas.map((delta) => {
    if (delta.baseStateVersionId) {
      const base = byId.get(delta.baseStateVersionId);
      return [delta.id, base
        ? { status: "ready", current: "base", value: base.value }
        : { status: "refresh_required" }];
    }

    const currentSameKey = currentState.current.some((state) => state.domain === delta.domain && state.stateKey === delta.proposedStateKey);
    return [delta.id, currentSameKey
      ? { status: "refresh_required" }
      : { status: "ready", current: "addition" }];
  })) as Record<string, ClinicalStateReviewComparison>;
}
