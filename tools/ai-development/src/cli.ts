import { approveRefinement } from "./commands/approve-refinement.js";
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
  if (command !== "status" && command !== "validate" && command !== "approve-refinement") {
    stderr("Unsupported command. Available commands: smaran status <work-item>, smaran validate <work-item>, smaran approve-refinement <work-item> --evidence <github-pr-comment-url>.");
    return 2;
  }
  const approval = command === "approve-refinement";
  if (!id || (approval ? args.length !== 4 || args[2] !== "--evidence" || !args[3] : args.length !== 2)) {
    stderr(`Usage: smaran ${command} <work-item>${approval ? " --evidence <github-pr-comment-url>" : ""}`); return 2;
  }
  try {
    const root = options.repoRoot ?? await findRepositoryRoot();
    if (approval) { stdout(await approveRefinement(root, id, args[3]!)); return 0; }
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
