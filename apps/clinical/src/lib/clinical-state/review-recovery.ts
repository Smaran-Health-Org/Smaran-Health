type ReviewOutcome = "stale_comparison" | "already_resolved" | "merged_or_stale_patient_context" | string | undefined;

export function reviewSubmissionRecovery(outcome: ReviewOutcome) {
  if (outcome === "stale_comparison" || outcome === "already_resolved" || outcome === "merged_or_stale_patient_context") {
    return {
      refreshRequired: true,
      message: "One or more changes were updated elsewhere. Refresh changes before applying again.",
    };
  }
  return {
    refreshRequired: false,
    message: "We couldn’t apply the reviewed changes right now. Please try again.",
  };
}
