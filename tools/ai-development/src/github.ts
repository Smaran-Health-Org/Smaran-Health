import { execFile } from "node:child_process";
import { isValidGitBranchName } from "./branches.js";
import { assertRelativePath, InputError } from "./paths.js";

/** Typed operation surface; results stay unknown until independently validated. */
export interface GitHubTransport {
  repository(): Promise<unknown>;
  branch(name: string): Promise<unknown>;
  pull(number: string): Promise<unknown>;
  comment(id: string): Promise<unknown>;
  commentIntegrity(nodeId: string): Promise<unknown>;
  commit(sha: string): Promise<unknown>;
  file(sha: string, path: string): Promise<Buffer>;
  permission(login: string): Promise<unknown>;
  ancestry(base: string, head: string): Promise<unknown>;
}
const SHA = /^[a-f0-9]{40}$/;
function commitId(value: string): string { if (!SHA.test(value)) throw new InputError("INVALID_COMMIT"); return value; }
function number(value: string): string { if (!/^[1-9][0-9]{0,14}$/.test(value)) throw new InputError("INVALID_ID"); return value; }
const QUERY = `query($id:ID!){node(id:$id){__typename ... on IssueComment{id databaseId url body createdAt updatedAt lastEditedAt editor{login} isMinimized userContentEdits(first:1){totalCount} author{__typename login ... on User{databaseId}} pullRequest{number repository{nameWithOwner}}}}}`;

/** gh receives arrays only. REST GET and a fixed GraphQL query over POST are read-only.
 * Never prints stderr, headers, tokens, response bodies or arbitrary API URLs.
 */
export class GhTransport implements GitHubTransport {
  private readonly prefix: string;
  constructor(repository: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) || repository.length > 160) throw new InputError("INVALID_REPOSITORY");
    this.prefix = `repos/${repository}`;
  }
  private async api(endpoint: string, fields: string[] = []): Promise<unknown> {
    const args = ["api", "--hostname", "github.com", "--method", endpoint === "graphql" ? "POST" : "GET", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint, ...fields];
    const output = await new Promise<string>((resolve, reject) => {
      execFile("gh", args, { shell: false, timeout: 20_000, maxBuffer: 4_194_304, encoding: "utf8",
        env: { ...process.env, GH_HOST: "github.com", GH_DEBUG: "", DEBUG: "" } }, (error, stdout) => {
        if (error) reject(new InputError("GITHUB_UNAVAILABLE")); else resolve(stdout);
      });
    });
    try { return JSON.parse(output) as unknown; } catch { throw new InputError("GITHUB_MALFORMED_RESPONSE"); }
  }
  repository(): Promise<unknown> { return this.api(this.prefix); }
  branch(name: string): Promise<unknown> {
    if (!isValidGitBranchName(name) || name.length > 128) throw new InputError("INVALID_BRANCH");
    return this.api(`${this.prefix}/branches/${encodeURIComponent(name)}`);
  }
  pull(id: string): Promise<unknown> { return this.api(`${this.prefix}/pulls/${number(id)}`); }
  comment(id: string): Promise<unknown> { return this.api(`${this.prefix}/issues/comments/${number(id)}`); }
  commentIntegrity(nodeId: string): Promise<unknown> {
    if (!/^[A-Za-z0-9_=-]{1,128}$/.test(nodeId)) throw new InputError("INVALID_NODE_ID");
    return this.api("graphql", ["-f", `query=${QUERY}`, "-f", `id=${nodeId}`]);
  }
  commit(sha: string): Promise<unknown> { return this.api(`${this.prefix}/commits/${commitId(sha)}`); }
  ancestry(base: string, head: string): Promise<unknown> { return this.api(`${this.prefix}/compare/${commitId(base)}...${commitId(head)}`); }
  async file(sha: string, path: string): Promise<Buffer> {
    assertRelativePath(path);
    const raw = object(await this.api(`${this.prefix}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, ["-f", `ref=${commitId(sha)}`]));
    if (raw.type !== "file" || raw.path !== path || raw.encoding !== "base64" || typeof raw.content !== "string"
      || !Number.isSafeInteger(raw.size) || (raw.size as number) < 0 || (raw.size as number) > 1_048_576) throw new InputError("GITHUB_MALFORMED_RESPONSE");
    const content = raw.content.replace(/\n/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new InputError("GITHUB_MALFORMED_RESPONSE");
    const bytes = Buffer.from(content, "base64");
    if (bytes.length !== raw.size || bytes.toString("base64") !== content) throw new InputError("GITHUB_MALFORMED_RESPONSE");
    return bytes;
  }
  permission(login: string): Promise<unknown> {
    if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(login) || login.length > 39) throw new InputError("INVALID_LOGIN");
    return this.api(`${this.prefix}/collaborators/${login}/permission`);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("GITHUB_MALFORMED_RESPONSE");
  return value as Record<string, unknown>;
}
export function stableId(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new InputError("GITHUB_MALFORMED_RESPONSE");
  return String(value);
}
