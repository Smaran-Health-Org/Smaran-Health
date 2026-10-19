import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Checks saved measurements from the supported browser. This is evidence
// verification, not a replacement for rerunning the browser interactions.
const rows = JSON.parse(readFileSync(new URL("./layout-observations.json", import.meta.url)));
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
for (const row of rows) {
  const label = `${row.surface} ${row.viewport.width}x${row.viewport.height}`;
  check(row.scrollWidth <= row.viewport.width + 1, `${label}: horizontal page overflow`);
  if (row.overflows) check(row.overflows.length === 0, `${label}: content outside viewport`);
  if (row.surface === "stages") {
    check(JSON.stringify(row.stages.map(s => s.title)) === JSON.stringify(["Expected", "Waiting", "With doctor", "Completed"]), `${label}: stage order`);
    check(row.stages.every(s => Number(s.count) === row.fixtureCountPerStage), `${label}: stage count`);
    if (row.viewport.width < 768) check(row.stages.every(s => s.rect.x === row.stages[0].rect.x), `${label}: phone stages must stack`);
  }
  if (row.surface === "booking" && row.modal === "true") {
    check(row.book.hit, `${label}: Book action obstructed`);
    check(row.book.rect.bottom <= row.viewport.height, `${label}: Book action offscreen after panel scroll`);
  }
}
console.log(`PASS: ${checks} assertions on ${rows.length} saved browser observations`);
console.log("Not covered by this verifier: actual browser zoom, physical devices, or unrecorded interactions.");
