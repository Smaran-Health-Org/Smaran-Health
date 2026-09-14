import { isAbsolute } from "node:path";
import { approveRefinement } from "./commands/approve-refinement.js";
import { inspectTrustedLauncher } from "./approval-git.js";
import { BOOTSTRAP } from "./bootstrap.js";
import { parseEvidenceUrl } from "./approval-evidence.js";
import { GhTransport, requireVerifierToken, type GitHubTransport } from "./github.js";
import { assertWorkItemId, InputError } from "./paths.js";

export const TRUSTED_USAGE = "Usage: trusted-approval <work-item> --evidence <github-pr-comment-url> --candidate-root <absolute-path> --candidate-head <40-char-lowercase-sha> --launcher-commit <40-char-lowercase-sha>";
export interface TrustedApprovalRequest {
  id: string;
  evidenceUrl: string;
  candidateRoot: string;
  candidateHead: string;
  launcherCommit: string;
}
export function parseTrustedArguments(args: string[]): TrustedApprovalRequest {
  if (args.length !== 9 || args[1] !== "--evidence" || args[3] !== "--candidate-root"
    || args[5] !== "--candidate-head" || args[7] !== "--launcher-commit") throw new InputError("INVALID_TRUSTED_ARGUMENTS");
  const request = { id: args[0]!, evidenceUrl: args[2]!, candidateRoot: args[4]!, candidateHead: args[6]!, launcherCommit: args[8]! };
  validateRequest(request);
  return request;
}
function validateRequest(request: TrustedApprovalRequest): void {
  assertWorkItemId(request.id);
  parseEvidenceUrl(request.evidenceUrl, BOOTSTRAP.repository);
  if (!isAbsolute(request.candidateRoot) || !/^[a-f0-9]{40}$/.test(request.candidateHead)
    || !/^[a-f0-9]{40}$/.test(request.launcherCommit)) throw new InputError("INVALID_TRUSTED_ARGUMENTS");
}
/** A diagnostic refusal, not a defense against preloads that already executed.
 * The operational invocation uses built JS with no Node loader/runtime flags.
 */
export function assertTrustedRuntime(env: NodeJS.ProcessEnv, runtimeArgs: string[]): void {
  if (runtimeArgs.length || Object.entries(env).some(([key, value]) => value
    && /^(NODE_OPTIONS|NODE_PATH|TSX_.*|LD_.*|DYLD_.*|npm_config_node_options)$/i.test(key))) throw new InputError("UNSAFE_RUNTIME_ENVIRONMENT");
}
/** Context is supplied by executing trusted code, never parsed from candidate data
 * or CLI options. Transport injection remains a library/testing seam only.
 */
export interface TrustedExecutionContext {
  modulePath: string;
  env: NodeJS.ProcessEnv;
  runtimeArgs: string[];
  transport?: GitHubTransport;
}
export async function approveFromTrustedLauncher(request: TrustedApprovalRequest, context: TrustedExecutionContext): Promise<string> {
  validateRequest(request);
  assertTrustedRuntime(context.env, context.runtimeArgs);
  const token = requireVerifierToken(context.env.SMARAN_AI_DEV_VERIFIER_TOKEN);
  const root = await inspectTrustedLauncher(context.modulePath, request.candidateRoot, request.launcherCommit);
  return approveRefinement(request.candidateRoot, request.id, request.evidenceUrl, {
    launcherRoot: root, expectedHead: request.candidateHead,
    transport: context.transport ?? new GhTransport(BOOTSTRAP.repository, { verifierToken: token }),
    assertLauncherTrust: async () => { await inspectTrustedLauncher(context.modulePath, request.candidateRoot, request.launcherCommit); },
  });
}
