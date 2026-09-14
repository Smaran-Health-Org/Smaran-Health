import assert from "node:assert/strict";
import test from "node:test";
import { approvalStatement, matchesApprovalStatement, parseEvidenceUrl } from "../src/approval-evidence.js";
import { BOOTSTRAP } from "../src/bootstrap.js";
import { URL } from "./approval-helpers.js";
const binding = { repository: BOOTSTRAP.repository, workItem: "TEST-001", candidate: "a".repeat(40), briefHash: "b".repeat(64) };
const body = approvalStatement(binding);
for (const [label, value] of [["LF", body], ["CRLF", body.replace(/\n/g, "\r\n")], ["LF final newline", body + "\n"], ["CRLF final newline", body.replace(/\n/g, "\r\n") + "\r\n"]]) {
  test(`statement accepts ${label}`, () => assert.equal(matchesApprovalStatement(value!, binding), true));
}
const badBodies = {
  "extra prose": body + "\nThanks", "blockquote": "> " + body, "code fence": "```\n" + body + "\n```",
  "wrong repository": body.replace(binding.repository, "wrong/repo"), "wrong work item": body.replace("TEST-001", "TEST-002"),
  "wrong candidate": body.replace(binding.candidate, "c".repeat(40)), "wrong hash": body.replace(binding.briefHash, "c".repeat(64)),
  "wrong decision": body.replace("decision: APPROVE", "decision: REJECT"), "short candidate": body.replace(binding.candidate, "a".repeat(7)),
  "short hash": body.replace(binding.briefHash, "b".repeat(8)), "duplicate field": body.replace("work-item:", "repository: wrong/repo\nwork-item:"),
  "trailing space": body + " ", "field trailing space": body.replace(" v1\n", " v1 \n"), "lone CR": body.replace("\n", "\r"),
  "oversized UTF8": "😀".repeat(513), "double final newline": body + "\n\n", "wrong order": body.replace("repository:", "work-item:"),
  "uppercase SHA": body.replace(binding.candidate, "A".repeat(40)), "wrong final sentence": body.replace("planning only.", "implementation.") };
for (const [label, value] of Object.entries(badBodies)) test(`statement rejects ${label}`, () => assert.equal(matchesApprovalStatement(value, binding), false));
test("canonical PR conversation URL accepted", () => assert.deepEqual(parseEvidenceUrl(URL, BOOTSTRAP.repository), { url: URL, pr: "1", comment: "2" }));
const badUrls = {
  "wrong host": URL.replace("github.com", "evil.example"), "host suffix": URL.replace("github.com", "github.com.evil.example"),
  "wrong repository": URL.replace(BOOTSTRAP.repository, "wrong/repo"), "query": URL.replace("#", "?a=b#"), "credentials": URL.replace("github.com", "user@github.com"),
  "alternate port": URL.replace("github.com", "github.com:8443"), "default port": URL.replace("github.com", "github.com:443"),
  "issue URL": URL.replace("/pull/", "/issues/"), "review URL": URL.replace("issuecomment-", "pullrequestreview-"),
  "inline review URL": URL.replace("issuecomment-", "discussion_r"), "commit URL": URL.replace("/pull/1", "/commit/" + "a".repeat(40)),
  "zero PR": URL.replace("/pull/1", "/pull/0"), "negative PR": URL.replace("/pull/1", "/pull/-1"), "leading zero PR": URL.replace("/pull/1", "/pull/01"),
  "zero comment": URL.replace("issuecomment-2", "issuecomment-0"), "leading zero comment": URL.replace("issuecomment-2", "issuecomment-02"),
  "negative comment": URL.replace("issuecomment-2", "issuecomment--2"), "encoded slash": URL.replace("/pull/", "/%70ull/"),
  "encoded traversal": URL.replace("/pull/", "/x/%2e%2e/pull/"), "literal traversal": URL.replace("/pull/", "/x/../pull/"),
  "fragment extra": URL + "&extra", "trailing slash": URL.replace("#", "/#"), "HTTP": URL.replace("https:", "http:") };
for (const [label, value] of Object.entries(badUrls)) test(`URL rejects ${label}`, () => assert.throws(() => parseEvidenceUrl(value, BOOTSTRAP.repository)));
