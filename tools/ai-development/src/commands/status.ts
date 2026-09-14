import { nextConceptualAction } from "../state.js";
import type { ValidationReport } from "./validate.js";

export function formatStatus(report: ValidationReport): string {
  const state = report.state;
  const lines = [state ? `${state.work_item_id}: ${state.title}` : "Work Item state could not be safely loaded.",
    `RECORDED STATE: ${state?.state ?? "unavailable"}`,
    `Refinement gate (recorded): ${state?.gates.refinement.status ?? "unavailable"}`,
    `Plan gate (recorded): ${state?.gates.plan.status ?? "unavailable"}`];
  if (state) {
    lines.push(`Target/base branch: ${state.repository.target_branch}`,
      `Feature branch: ${state.repository.feature_branch ?? "not recorded"}`,
      `Base commit: ${state.repository.base_commit ?? "not recorded"}`,
      `Source commit: ${state.repository.source_commit ?? "not recorded"}`);
    for (const name of ["brief", "context", "plan"]) {
      const artifact = report.artifacts.find((entry) => entry.name === name);
      lines.push(`Artifact ${name}: ${artifact ? `${artifact.present ? "present" : "unavailable"}; hash ${artifact.hash}` : "not recorded"}`);
    }
  }
  lines.push(`VALIDATION: ${report.valid ? "PASS" : "FAIL"}`,
    "GATE VALIDITY: local consistency only; human identity, evidence and Git commits are not verified offline. EXTERNAL APPROVAL VALIDITY: not checked.");
  if (report.issues.length) lines.push("BLOCKERS:", ...report.issues.map((issue) => `- ${issue}`));
  lines.push(`Next conceptual action: ${!report.valid ? "resolve validation blockers; no advancement permitted" : state ? nextConceptualAction(state.state) : "resolve missing state"}`);
  return lines.join("\n");
}
