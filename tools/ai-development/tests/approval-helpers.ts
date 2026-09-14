import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { approvalStatement } from "../src/approval-evidence.js";
import { BOOTSTRAP } from "../src/bootstrap.js";
import { sha256 } from "../src/hashes.js";
import type { GitHubTransport } from "../src/github.js";
import { createSchemaValidator, parseRestrictedYaml } from "../src/validation.js";
import type { PipelineConfig } from "../src/config.js";
import type { WorkItemState } from "../src/state.js";
import type { TrustedContext } from "../src/refinement-verifier.js";
import { fixture, syntheticState, ID, briefBytes, schema } from "./helpers.js";

export const URL = `https://github.com/${BOOTSTRAP.repository}/pull/1#issuecomment-2`;
export const DATE = "2026-09-14T00:00:00Z";
export function testGit(root: string, args: string[]): Buffer {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Synthetic", "-c", "user.email=synthetic@invalid", "-C", root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}
export async function approvalFixture() {
  const f = await fixture();
  testGit(f.root, ["init", "-q", "-b", "dev-neelesh"]);
  await writeFile(join(f.root, "source.md"), "Synthetic pinned source\n");
  testGit(f.root, ["add", "--", ".ai-development", "source.md"]);
  testGit(f.root, ["commit", "-qm", "synthetic base"]);
  const base = testGit(f.root, ["rev-parse", "HEAD"]).toString().trim();
  testGit(f.root, ["switch", "-qc", "codex/test-approval"]);
  f.state.repository.feature_branch = "codex/test-approval";
  f.state.repository.base_commit = base; f.state.repository.source_commit = base;
  f.state.sources = [{ path: "source.md", commit: base, sha256: sha256(Buffer.from("Synthetic pinned source\n")) }];
  f.state.artifacts.brief.sha256 = sha256(briefBytes);
  await f.save();
  testGit(f.root, ["add", "--", ".ai-development"]);
  testGit(f.root, ["commit", "-qm", "synthetic pending candidate"]);
  const candidate = testGit(f.root, ["rev-parse", "HEAD"]).toString().trim();
  const stateBytes = await readFile(f.statePath);
  const policy = parseRestrictedYaml(await readFile(join(f.root, ".ai-development/pipeline.config.yml"))) as PipelineConfig;
  policy.approvals.refinement.authorized_github_users = [{ login: "ExampleHuman", id: "123" }];
  const policyBytes = () => Buffer.from(stringify(policy));
  const body = approvalStatement({ repository: BOOTSTRAP.repository, workItem: ID, candidate, briefHash: sha256(briefBytes) });
  const repo: { full_name: string } = { full_name: BOOTSTRAP.repository };
  const user = { type: "User", login: "ExampleHuman", id: 123 };
  const data = {
    repo,
    pr: { number: 1, state: "open", html_url: `https://github.com/${BOOTSTRAP.repository}/pull/1`,
      base: { ref: "dev-neelesh", repo }, head: { ref: "codex/test-approval", sha: candidate, repo } },
    comment: { id: 2, node_id: "IC_synthetic", html_url: URL, issue_url: `https://api.github.com/repos/${BOOTSTRAP.repository}/issues/1`, user, body, created_at: DATE, updated_at: DATE },
    graph: { data: { node: { __typename: "IssueComment", id: "IC_synthetic", databaseId: 2, url: URL, body, createdAt: DATE, updatedAt: DATE,
      lastEditedAt: null as unknown, editor: null as unknown, isMinimized: false, userContentEdits: { totalCount: 0 },
      author: { __typename: "User", login: "ExampleHuman", databaseId: 123 }, pullRequest: { number: 1, repository: { nameWithOwner: BOOTSTRAP.repository as string } } } } },
    permission: { permission: "write", user: { ...user } },
  };
  const transport: GitHubTransport = {
    repository: async () => data.repo,
    branch: async (name) => ({ name, commit: { sha: name === "dev-neelesh" ? base : candidate } }),
    pull: async () => data.pr, comment: async () => data.comment, commentIntegrity: async () => data.graph,
    commit: async (sha) => ({ sha }), permission: async () => data.permission,
    ancestry: async (base) => ({ base_commit: { sha: base }, merge_base_commit: { sha: base }, status: "ahead" }),
    file: async (sha, path) => {
      if (path === ".ai-development/pipeline.config.yml") return policyBytes();
      return testGit(f.root, ["show", `${sha}:${path}`]);
    },
  };
  const ctx: TrustedContext = { bootstrap: BOOTSTRAP, github: transport, candidate, candidateStateBytes: stateBytes, briefBytes, evidenceUrl: URL,
    configValidator: createSchemaValidator<PipelineConfig>(await schema("config")), stateValidator: createSchemaValidator<WorkItemState>(await schema("state")) };
  return { ...f, base, candidate, stateBytes, policy, data, transport, ctx };
}
export async function fingerprint(root: string, statePath: string) {
  const index = testGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).toString().trim();
  return { head: testGit(root, ["rev-parse", "HEAD"]).toString(), state: await readFile(statePath), index: await readFile(index),
    status: testGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).toString() };
}
