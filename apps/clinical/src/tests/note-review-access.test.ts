import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteReviewAccess } from "../app/consultations/[id]/note-review-access";

function renderReview(canReviewNote: boolean) {
  return renderToStaticMarkup(createElement(NoteReviewAccess, {
    canReviewNote,
    actions: createElement("div", null, ...["Save draft", "Reject draft", "Approve note"].map(
      (label) => createElement("button", { key: label }, label),
    )),
  }, createElement("textarea", { defaultValue: "Synthetic draft" })));
}

test("another doctor sees a read-only draft and no review actions", () => {
  const html = renderReview(false);
  assert.match(html, /role="status"/);
  assert.match(html, /Only the assigned doctor can edit, save, reject, or approve/);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /Synthetic draft/);
  for (const label of ["Save draft", "Reject draft", "Approve note"]) assert.ok(!html.includes(label));
});

test("the assigned doctor retains editable fields and all review actions", () => {
  const html = renderReview(true);
  assert.doesNotMatch(html, /disabled=""|Read-only note/);
  for (const label of ["Save draft", "Reject draft", "Approve note"]) assert.ok(html.includes(label));
});
