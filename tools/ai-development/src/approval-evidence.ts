import { InputError, assertWorkItemId } from "./paths.js";

export interface EvidenceLocation { url: string; pr: string; comment: string }
export interface StatementBinding { repository: string; workItem: string; candidate: string; briefHash: string }
export function parseEvidenceUrl(value: string, repository: string): EvidenceLocation {
  // Compare raw input, not URL's normalized representation (ports/escapes/credentials).
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/([1-9][0-9]{0,14})#issuecomment-([1-9][0-9]{0,14})$/.exec(value);
  if (!match || match[1] !== repository) throw new InputError("INVALID_EVIDENCE_URL");
  return { url: value, pr: match[2]!, comment: match[3]! };
}
export function approvalStatement(binding: StatementBinding): string {
  assertWorkItemId(binding.workItem);
  if (!/^[a-f0-9]{40}$/.test(binding.candidate) || !/^[a-f0-9]{64}$/.test(binding.briefHash)) throw new InputError("INVALID_BINDING");
  return `SMARAN-REFINEMENT-APPROVAL v1\nrepository: ${binding.repository}\nwork-item: ${binding.workItem}\ncandidate-commit: ${binding.candidate}\nbrief-sha256: ${binding.briefHash}\ndecision: APPROVE\nI approve this exact Brief for planning only.`;
}
export function matchesApprovalStatement(body: string, binding: StatementBinding): boolean {
  if (Buffer.byteLength(body, "utf8") > 2048 || /\r(?!\n)/.test(body)) return false;
  const normalized = body.replace(/\r\n/g, "\n");
  const expected = approvalStatement(binding);
  return normalized === expected || normalized === `${expected}\n`;
}
