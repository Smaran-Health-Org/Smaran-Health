/**
 * Literal branch-name validation, in process with no checkout-dependent expansion.
 * Reference: https://git-scm.com/docs/git-check-ref-format and Git refs.c
 * (check_refname_format/check_branch_ref).
 *
 * Allows single-level names and Git-valid punctuation/Unicode. Rejects leading
 * '-', reserved HEAD, '..', '@{', a final '.', ASCII controls/DEL, space and
 * ~ ^ : ? * [ backslash. Every slash-separated component must be nonempty,
 * must not start with '.', and must not end with '.lock'. Thus leading/trailing
 * and duplicate slashes are rejected. No normalization or @{-n} expansion occurs.
 * Lone '@' is also rejected by pipeline policy (the generic ref rule), although
 * Git's --branch mode accepts it after adding the refs/heads/ prefix.
 * Schema length/type bounds remain separate from these semantic constraints.
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.startsWith("-") || name === "HEAD" || name === "@") return false;
  if (name.includes("..") || name.includes("@{") || name.endsWith(".")) return false;
  if (/[\x00-\x20\x7f~^:?*\[\\]/u.test(name)) return false;
  return name.split("/").every((component) =>
    component.length > 0 && !component.startsWith(".") && !component.endsWith(".lock"));
}

/** Field-only diagnostics; never include untrusted branch values. */
export function branchNameIssues(fields: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(fields).flatMap(([field, name]) =>
    name !== undefined && !isValidGitBranchName(name) ? [`${field}: Invalid Git branch name.`] : []);
}
