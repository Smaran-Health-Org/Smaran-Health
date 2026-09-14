import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, rm, mkdtemp, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { InputError, existingPipelinePath, workItemPath } from "./paths.js";

// Private subprocess primitive; no shell, no hooks or fsmonitor, no ambient GIT_*.
function gitEnvironment(index?: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" });
  if (index) env.GIT_INDEX_FILE = index;
  return env;
}
async function git(root: string, args: string[], input?: Buffer, index?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-C", root, ...args],
      { shell: false, timeout: 20_000, maxBuffer: 8_388_608, encoding: "buffer", env: gitEnvironment(index) }, (error, stdout) => {
        if (error) reject(new InputError("LOCAL_GIT_FAILURE")); else resolve(stdout);
      });
    child.stdin?.on("error", () => { /* execFile callback reports failures safely */ });
    child.stdin?.end(input);
  });
}
/** Hold Git's own branch/HEAD ref locks across final safety checks. */
async function prepareApprovalRef(root: string, branch: string, commit: string, expected: string) {
  let preparedResolve!: () => void; let preparedReject!: (error: Error) => void;
  const prepared = new Promise<void>((resolve, reject) => { preparedResolve = resolve; preparedReject = reject; });
  let completionResolve!: () => void; let completionReject!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => { completionResolve = resolve; completionReject = reject; });
  // Attach immediately so early process failures are never unhandled rejections.
  void completion.catch(() => {});
  const child = execFile("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "user.name=Smaran Orchestrator",
    "-c", "user.email=smaran-orchestrator@invalid", "-C", root, "update-ref", "--no-deref", "--stdin", "-z"],
    { shell: false, timeout: 20_000, maxBuffer: 4096, encoding: "buffer", env: gitEnvironment() }, (error) => {
      if (error) { const safe = new InputError("LOCAL_REF_TRANSACTION_FAILED"); preparedReject(safe); completionReject(safe); }
      else { if (!output.includes("prepare: ok\n")) preparedReject(new InputError("LOCAL_REF_TRANSACTION_FAILED")); completionResolve(); }
    });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.includes("prepare: ok\n")) preparedResolve(); });
  child.stdin?.on("error", () => { preparedReject(new InputError("LOCAL_REF_TRANSACTION_FAILED")); });
  child.stdin?.write(Buffer.from(`start\0update refs/heads/${branch}\0${commit}\0${expected}\0prepare\0`));
  try { await prepared; } catch (error) { child.stdin?.end(); throw error; }
  let finished = false;
  return {
    async finish(accept: boolean) {
      if (finished) return;
      finished = true; child.stdin?.end(Buffer.from(accept ? "commit\0" : "abort\0")); await completion;
      if (accept && !output.includes("commit: ok\n")) throw new InputError("LOCAL_REF_TRANSACTION_FAILED");
    },
  };
}
async function text(root: string, args: string[], input?: Buffer, index?: string): Promise<string> {
  return (await git(root, args, input, index)).toString("utf8").trim();
}
export interface CandidateSnapshot { root: string; branch: string; head: string; indexPath: string; indexBytes: Buffer }
export async function inspectCandidate(root: string, branch: string, expectedHead?: string): Promise<CandidateSnapshot> {
  const physical = await realpath(root);
  if (await realpath(await text(root, ["rev-parse", "--show-toplevel"])) !== physical) throw new InputError("ROOT_MISMATCH");
  const attached = await text(root, ["symbolic-ref", "--quiet", "HEAD"]);
  if (attached !== `refs/heads/${branch}`) throw new InputError("BRANCH_MISMATCH");
  const head = await text(root, ["rev-parse", "--verify", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(head) || (expectedHead && head !== expectedHead)) throw new InputError("HEAD_CHANGED");
  for (const operation of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer"]) {
    const path = await text(root, ["rev-parse", "--path-format=absolute", "--git-path", operation]);
    try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw new InputError("LOCAL_GIT_FAILURE"); }
    throw new InputError("GIT_OPERATION_IN_PROGRESS");
  }
  // Git status can invoke configured clean/process filters. Reject them rather
  // than executing repository-selected commands in security-sensitive tooling.
  const configKeys = (await git(root, ["config", "--null", "--name-only", "--list"])).toString("utf8").split("\0");
  if (configKeys.some((key) => /^filter\./i.test(key))) throw new InputError("UNSUPPORTED_GIT_FILTERS");
  if ((await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length) throw new InputError("WORKTREE_NOT_CLEAN");
  // Assume-unchanged / skip-worktree must not conceal modified tracked content.
  if ((await git(root, ["ls-files", "-v", "-z"])).toString("utf8").split("\0").some((entry) => entry && !entry.startsWith("H "))) throw new InputError("UNSUPPORTED_INDEX_FLAGS");
  const indexPath = await text(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const info = await lstat(indexPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new InputError("UNSAFE_INDEX");
  return { root: physical, branch, head, indexPath, indexBytes: await readFile(indexPath) };
}
export async function candidateFile(snapshot: CandidateSnapshot, commit: string, path: string): Promise<Buffer> {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new InputError("INVALID_COMMIT");
  // Caller supplies a confined, validated path. Require ordinary blob mode.
  const entry = await text(snapshot.root, ["ls-tree", commit, "--", path]);
  if (!entry.startsWith("100644 blob ") || entry.split("\t")[1] !== path) throw new InputError("CANDIDATE_FILE_INVALID");
  return git(snapshot.root, ["show", `${commit}:${path}`]);
}
/** Linear STATE-only history, checked against real immutable Git objects. Remote
 * tips must be on the inspected local line; fetch/synchronize explicitly first. */
export async function approvalHistory(snapshot: CandidateSnapshot, candidate: string, statePath: string, tips: string[]) {
  for (const tip of [candidate, ...tips]) {
    if (!/^[a-f0-9]{40}$/.test(tip)) throw new InputError("INVALID_COMMIT");
    try {
      await git(snapshot.root, ["merge-base", "--is-ancestor", tip, snapshot.head]);
      await git(snapshot.root, ["merge-base", "--is-ancestor", candidate, tip]);
    } catch { throw new InputError("HISTORY_ANCESTRY_INVALID"); }
  }
  const commits = (await text(snapshot.root, ["rev-list", "--reverse", `${candidate}..${snapshot.head}`])).split("\n").filter(Boolean);
  if (!commits.length) throw new InputError("APPROVAL_PARENT_MISMATCH");
  let parent = candidate;
  const history: { commit: string; stateBytes: Buffer }[] = [];
  for (const commit of commits) {
    if (await text(snapshot.root, ["rev-list", "--parents", "-n", "1", commit]) !== `${commit} ${parent}`) throw new InputError("APPROVAL_PARENT_MISMATCH");
    if (await text(snapshot.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", parent, commit]) !== statePath) throw new InputError("APPROVAL_COMMIT_SCOPE_INVALID");
    history.push({ commit, stateBytes: await candidateFile(snapshot, commit, statePath) });
    parent = commit;
  }
  return history;
}

/** One STATE-only commit, isolated index, compare-and-swap branch update.
 * No git add/reset/checkout, signing or hooks. Failures before update-ref leave
 * HEAD, STATE and real index untouched. Objects may remain unreachable.
 * Ref update is the commit point. OS/crash failure afterwards requires manual
 * reconciliation; report it, never broad-reset or undo a concurrent writer.
 */
export async function commitRefinementApproval(snapshot: CandidateSnapshot, statePath: string, before: Buffer, after: Buffer, id: string): Promise<string> {
  if (statePath !== `${workItemPath(id)}/STATE.yml`) throw new InputError("UNSAFE_STATE_PATH");
  const safe = await existingPipelinePath(snapshot.root, statePath);
  let lock; let refTransaction: Awaited<ReturnType<typeof prepareApprovalRef>> | undefined;
  const temporary = await mkdtemp(join(tmpdir(), "smaran-approval-index-"));
  const isolatedIndex = join(temporary, "index");
  const preparedState = join(dirname(safe), `.STATE-approval-${process.pid}.tmp`);
  let refCommitted = false; let statePrepared = false;
  try {
    lock = await open(`${snapshot.indexPath}.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await inspectCandidate(snapshot.root, snapshot.branch, snapshot.head);
    if (!(await readFile(snapshot.indexPath)).equals(snapshot.indexBytes) || !(await readFile(safe)).equals(before)) throw new InputError("INPUT_CHANGED");
    await git(snapshot.root, ["read-tree", snapshot.head], undefined, isolatedIndex);
    const blob = await text(snapshot.root, ["hash-object", "-w", "--stdin"], after);
    await git(snapshot.root, ["update-index", "--add", "--cacheinfo", `100644,${blob},${statePath}`], undefined, isolatedIndex);
    const tree = await text(snapshot.root, ["write-tree"], undefined, isolatedIndex);
    // Fixed orchestrator commit identity; evidence user is recorded solely in STATE.
    const commit = await text(snapshot.root, ["-c", "user.name=Smaran Orchestrator", "-c", "user.email=smaran-orchestrator@invalid", "commit-tree", tree, "-p", snapshot.head], Buffer.from(`chore(ai-dev): approve refinement for ${id}\n`));
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new InputError("LOCAL_GIT_FAILURE");
    refTransaction = await prepareApprovalRef(snapshot.root, snapshot.branch, commit, snapshot.head);
    // Last pre-commit checks catch HEAD/index/state/branch/worktree changes during preparation.
    await inspectCandidate(snapshot.root, snapshot.branch, snapshot.head);
    if (!(await readFile(snapshot.indexPath)).equals(snapshot.indexBytes) || !(await readFile(safe)).equals(before)
      || await existingPipelinePath(snapshot.root, statePath) !== safe) throw new InputError("INPUT_CHANGED");
    await writeFile(preparedState, after, { flag: "wx", mode: 0o644 }); statePrepared = true;
    await lock.writeFile(await readFile(isolatedIndex)); await lock.sync();
    const ref = `refs/heads/${snapshot.branch}`;
    try { await refTransaction.finish(true); }
    catch (error) {
      // A timeout can be ambiguous after the Git commit point. Never claim
      // rollback if the ref outcome cannot be determined.
      let actual: string;
      try { actual = await text(snapshot.root, ["rev-parse", "--verify", ref]); }
      catch { refCommitted = true; throw new InputError("COMMIT_CREATED_RECONCILIATION_REQUIRED"); }
      if (actual !== commit) throw error;
    }
    refCommitted = true;
    await rename(preparedState, safe); statePrepared = false;
    await lock.close(); lock = undefined;
    await rename(`${snapshot.indexPath}.lock`, snapshot.indexPath);
    return commit;
  } catch (error) {
    if (refCommitted) throw new InputError("COMMIT_CREATED_RECONCILIATION_REQUIRED");
    if (error instanceof InputError) throw error;
    throw new InputError("LOCAL_TRANSACTION_FAILED");
  } finally {
    if (refTransaction) { try { await refTransaction.finish(false); } catch { /* failure already reported; Git releases its locks on exit */ } }
    if (lock) { await lock.close(); await rm(`${snapshot.indexPath}.lock`, { force: true }); }
    if (statePrepared) await rm(preparedState, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}
