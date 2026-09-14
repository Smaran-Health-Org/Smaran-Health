import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep, win32 } from "node:path";

export const ARTIFACT_ROOT = ".ai-development";
export const WORK_ITEM_ROOT = `${ARTIFACT_ROOT}/work-items`;
export const WORK_ITEM_ID_PATTERN = "^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$";
export const MAX_PATH_LENGTH = 256;

export class InputError extends Error {}

export function assertWorkItemId(id: string): void {
  if (id.length > 64 || !new RegExp(WORK_ITEM_ID_PATTERN).test(id)) {
    throw new InputError("Invalid Work Item ID: use uppercase letters/digits separated by hyphens (for example TEST-001), at most 64 characters.");
  }
}

export function assertRelativePath(path: string): void {
  if (!path || path.length > MAX_PATH_LENGTH || isAbsolute(path) || win32.isAbsolute(path)
    || path.split("/").some((part) => part === "." || part === ".." || !/^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(part))) {
    throw new InputError("Unsafe path: use a repository-relative path without traversal, backslashes, empty segments or special characters.");
  }
}

export function workItemPath(id: string): string {
  assertWorkItemId(id);
  return `${WORK_ITEM_ROOT}/${id}`;
}

export function assertArtifactPath(path: string, id: string): void {
  assertRelativePath(path);
  if (!path.startsWith(`${workItemPath(id)}/`)) {
    throw new InputError("Artifact path must stay inside the requested Work Item directory.");
  }
}

/** Reject all symlinks under the pipeline root, including links that stay inside it. */
export async function existingPipelinePath(repoRoot: string, path: string): Promise<string> {
  assertRelativePath(path);
  if (!path.startsWith(`${ARTIFACT_ROOT}/`)) throw new InputError("Path must stay inside .ai-development/.");
  const root = await realpath(repoRoot);
  let candidate = root;
  for (const part of path.split("/")) {
    candidate = join(candidate, part);
    let info;
    try { info = await lstat(candidate); }
    catch { throw new InputError(`Required path not found or inaccessible: ${path}`); }
    if (info.isSymbolicLink()) throw new InputError(`Symlinks are not allowed in pipeline paths: ${path}`);
  }
  const physical = await realpath(candidate);
  const inside = relative(root, physical);
  if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) {
    throw new InputError("Resolved path escapes the repository.");
  }
  return physical;
}

/** Bound the actual read, not only a prior stat; never follow a final symlink. */
export async function readPipelineBytes(repoRoot: string, path: string, maxBytes: number): Promise<Buffer> {
  const safe = await existingPipelinePath(repoRoot, path);
  let handle;
  try { handle = await open(safe, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new InputError(`Cannot read pipeline file: ${path}`); }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new InputError(`Expected a regular file: ${path}`);
    if (info.size > maxBytes) throw new InputError(`File exceeds ${maxBytes}-byte limit: ${path}`);
    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const result = await handle.read(bytes, used, bytes.length - used, used);
      if (result.bytesRead === 0) break;
      used += result.bytesRead;
    }
    if (used > maxBytes) throw new InputError(`File exceeds ${maxBytes}-byte limit: ${path}`);
    // Detect an ancestor replaced with a symlink during the read.
    if (await existingPipelinePath(repoRoot, path) !== safe) throw new InputError("Pipeline path changed during validation.");
    return bytes.subarray(0, used);
  } finally { await handle.close(); }
}
