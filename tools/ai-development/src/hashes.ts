import { createHash } from "node:crypto";
import { readPipelineBytes } from "./paths.js";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function hashArtifact(repoRoot: string, path: string, maxBytes: number): Promise<string> {
  return sha256(await readPipelineBytes(repoRoot, path, maxBytes));
}
