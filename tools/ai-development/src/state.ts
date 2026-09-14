export const STATES = ["refinement_pending", "refinement_approved", "planning", "plan_ready", "plan_approved"] as const;
export type WorkflowState = typeof STATES[number];
export type GateStatus = "pending" | "approved" | "invalidated";
export interface Approval {
  actor: { kind: "human"; id: string };
  at: string;
  artifact_sha256: string;
  artifact_commit: string;
  evidence: { kind: "github_comment" | "github_review"; url: string; id: string };
}
export interface Gate { status: GateStatus; approval?: Approval; invalidation_reason?: string }
export interface Artifact { path: string; sha256?: string }
export interface WorkItemState {
  schema_version: "ai-development-state/v1";
  work_item_id: string;
  title: string;
  domain?: string;
  state: WorkflowState;
  revision: number;
  repository: { identifier: string; target_branch: string; feature_branch?: string; base_commit?: string; source_commit?: string };
  sources: { path: string; selector?: { kind: "heading" | "acceptance_criterion"; value: string }; commit?: string; sha256?: string }[];
  artifacts: { brief: Artifact; context?: Artifact; plan?: Artifact };
  gates: { refinement: Gate; plan: Gate };
  provenance?: { run_id: string; input_commit: string };
  last_transition?: { from: WorkflowState; to: WorkflowState; at: string; actor: string };
}

export function isWorkflowState(state: unknown): state is WorkflowState {
  return typeof state === "string" && (STATES as readonly string[]).includes(state);
}

/** Topology only. This function does not authorize a transition. */
export function isLegalEdge(from: unknown, to: unknown): boolean {
  return isWorkflowState(from) && isWorkflowState(to) && STATES.indexOf(to) === STATES.indexOf(from) + 1;
}

export interface TransitionChecks {
  authority: "orchestrator";
  inputsUnchanged: boolean;
  refinementApprovalVerified?: boolean;
  planningResultValidated?: boolean;
  planApprovalVerified?: boolean;
}

/** Pure guard for future orchestrator callers; does not write or return an updated state. */
export function assertTransition(from: unknown, to: unknown, checks: TransitionChecks): void {
  if (!isLegalEdge(from, to)) throw new Error("Illegal or unsupported workflow transition.");
  if (checks.authority !== "orchestrator" || checks.inputsUnchanged !== true) throw new Error("Transition requires orchestrator authority and unchanged inputs.");
  if (checks.refinementApprovalVerified !== true) throw new Error("Transition requires verified human refinement approval.");
  if ((to === "plan_ready" || to === "plan_approved") && checks.planningResultValidated !== true) throw new Error("Transition requires validated planning output.");
  if (to === "plan_approved" && checks.planApprovalVerified !== true) throw new Error("Transition requires verified human plan approval.");
}

export function stateConsistencyIssues(state: WorkItemState): string[] {
  const issues: string[] = [];
  const index = STATES.indexOf(state.state);
  if (index < 0) return ["Unsupported workflow state."];
  const refinementExpected = index === 0 ? "pending" : "approved";
  const planExpected = state.state === "plan_approved" ? "approved" : "pending";
  for (const [name, expected] of [["refinement", refinementExpected], ["plan", planExpected]] as const) {
    const gate = state.gates[name];
    if (gate.status !== expected) issues.push(`${name} gate must be ${expected} for the recorded state; recorded ${gate.status}.`);
    if (gate.status === "invalidated") issues.push(`${name} gate is invalidated; advancement is blocked.`);
    if (gate.status === "approved") {
      const artifact = state.artifacts[name === "refinement" ? "brief" : "plan"];
      if (!gate.approval || !artifact?.sha256 || gate.approval.artifact_sha256 !== artifact.sha256) {
        issues.push(`${name} approval must bind the recorded artifact hash.`);
      }
    }
  }
  if (index > 0) {
    if (!state.repository.base_commit || !state.repository.source_commit) issues.push("Approved refinement requires base_commit and source_commit.");
    if (!state.artifacts.brief.sha256) issues.push("Approved refinement requires a brief SHA-256 hash.");
    if (state.revision === 0) issues.push("A state beyond refinement_pending requires a positive revision.");
  }
  if (index >= 2 && !state.provenance) issues.push("Planning states require run_id and input_commit provenance.");
  if (index >= 3) {
    if (!state.artifacts.context?.sha256) issues.push("A ready plan requires a context artifact and SHA-256 hash.");
    if (!state.artifacts.plan?.sha256) issues.push("A ready plan requires a plan artifact and SHA-256 hash.");
  }
  if (state.last_transition && (state.last_transition.to !== state.state || !isLegalEdge(state.last_transition.from, state.last_transition.to))) {
    issues.push("last_transition must describe a legal edge ending at the recorded state.");
  }
  const paths = Object.values(state.artifacts).map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) issues.push("Artifact paths must be distinct.");
  return issues;
}

export function nextConceptualAction(state: WorkflowState): string {
  return {
    refinement_pending: "human refinement approval (not implemented)",
    refinement_approved: "planning (not implemented)",
    planning: "complete and validate planning output (not implemented)",
    plan_ready: "human plan approval (not implemented)",
    plan_approved: "stop; later implementation workflow is not implemented",
  }[state];
}
