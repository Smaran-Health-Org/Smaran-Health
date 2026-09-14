import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findRepositoryRoot } from "./config.js";
import { formatStatus } from "./commands/status.js";
import { message, validateWorkItem } from "./commands/validate.js";

export interface CliOptions { repoRoot?: string; stdout?: (text: string) => void; stderr?: (text: string) => void }

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text) => process.stdout.write(`${text}\n`));
  const stderr = options.stderr ?? ((text) => process.stderr.write(`${text}\n`));
  const [command, id] = args;
  if (command !== "status" && command !== "validate") {
    stderr("Unsupported command. Available commands: smaran status <work-item>, smaran validate <work-item>.");
    return 2;
  }
  if (args.length !== 2 || !id) { stderr(`Usage: smaran ${command} <work-item>`); return 2; }
  try {
    const root = options.repoRoot ?? await findRepositoryRoot();
    const report = await validateWorkItem(root, id);
    if (command === "status") stdout(formatStatus(report));
    else if (report.valid) stdout(`${id}: validation passed (local contracts/artifacts only; approval evidence and Git provenance not verified).`);
    else stderr(`Validation failed:\n${report.issues.map((issue) => `- ${issue}`).join("\n")}`);
    return report.valid ? 0 : 1;
  } catch (error) { stderr(message(error)); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
