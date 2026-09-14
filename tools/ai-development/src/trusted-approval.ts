import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { approveFromTrustedLauncher, parseTrustedArguments, TRUSTED_USAGE } from "./trusted-runner.js";

export async function runTrustedApproval(args: string[], io: { stdout?: (text: string) => void; stderr?: (text: string) => void } = {}): Promise<number> {
  const stdout = io.stdout ?? ((text) => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? ((text) => process.stderr.write(`${text}\n`));
  let request;
  try { request = parseTrustedArguments(args); }
  catch { stderr(TRUSTED_USAGE); return 2; }
  try {
    stdout(await approveFromTrustedLauncher(request, {
      modulePath: fileURLToPath(import.meta.url), env: process.env, runtimeArgs: process.execArgv,
    }));
    return 0;
  } catch {
    // Never echo arbitrary input, subprocess output or credential-bearing errors.
    stderr("Trusted approval failed; launcher, runtime, explicit credential, candidate and evidence requirements must all be satisfied.");
    return 1;
  }
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  process.exitCode = await runTrustedApproval(process.argv.slice(2));
}
