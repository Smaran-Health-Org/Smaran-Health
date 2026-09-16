export type ReviewRefreshGuard = {
  refreshKeyAtFailure: string;
  mergedContext: boolean;
};

export function reviewRefreshGuardAfterServerProps(
  guard: ReviewRefreshGuard | null,
  refreshKey: string
): ReviewRefreshGuard | null {
  return guard?.refreshKeyAtFailure !== refreshKey ? null : guard;
}

/** Clears only the transient status once changed server props release the guard. */
export function reviewRefreshMessageAfterServerProps(
  guard: ReviewRefreshGuard | null,
  refreshKey: string,
  message: string | null
): string | null {
  return guard?.refreshKeyAtFailure !== refreshKey && message === "Refreshing changes…" ? null : message;
}

export function reviewActionsAreRefreshBlocked(guard: ReviewRefreshGuard | null): boolean {
  return guard !== null;
}

export function reviewRefreshRecoveryAction(guard: ReviewRefreshGuard | null): "none" | "refresh" | "clinic_desk" {
  if (!guard) return "none";
  return guard.mergedContext ? "clinic_desk" : "refresh";
}

/** Refresh requests retain the guard until changed server-derived props arrive. */
export function beginReviewRefresh(guard: ReviewRefreshGuard | null): ReviewRefreshGuard | null {
  return guard;
}
