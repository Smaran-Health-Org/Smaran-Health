/** Reviewed launcher/bootstrap identity, never derived from candidate STATE/config.
 * The dedicated trusted launcher supplies this context to the reusable verifier.
 * Operational enforcement of this code's trust remains required.
 */
export const BOOTSTRAP = Object.freeze({ repository: "DrSmaranAI/Smaran-Health", targetBranch: "dev-neelesh" });
export interface Bootstrap { readonly repository: string; readonly targetBranch: string }
