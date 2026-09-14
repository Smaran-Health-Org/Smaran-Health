import { InputError } from "./paths.js";
import type { Approval, WorkItemState } from "./state.js";

/** Deterministic mutation derived only after successful independent verification. */
export function approvedState(pending: WorkItemState, approval: Approval): WorkItemState {
  if (pending.state !== "refinement_pending" || pending.gates.refinement.status !== "pending"
    || pending.gates.refinement.approval || pending.gates.plan.status !== "pending") throw new InputError("TRANSITION_INVALID");
  if (!Number.isSafeInteger(pending.revision) || pending.revision >= Number.MAX_SAFE_INTEGER) throw new InputError("REVISION_OVERFLOW");
  const next = structuredClone(pending);
  next.state = "refinement_approved"; next.revision++;
  next.gates.refinement = { status: "approved", approval };
  next.last_transition = { from: "refinement_pending", to: "refinement_approved", at: approval.at, actor: "smaran:approve-refinement/v1" };
  return next;
}
