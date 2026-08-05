import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const contractDirectory = resolve(
  scriptDirectory,
  "../../../docs/schemas/clinical-note-schema/v0.1.0",
);

const schema = JSON.parse(
  await readFile(resolve(contractDirectory, "schema.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const clinicalSections = [
  "chief_complaint",
  "history",
  "examination_findings",
  "diagnoses_documented_by_doctor",
  "allergies_documented",
  "medications_mentioned",
  "medication_changes",
  "investigations_requested",
  "investigations_reviewed",
  "procedures_documented",
  "lifestyle_advice",
  "follow_up_plan",
  "patient_instructions",
  "uncertain_items",
];

function semanticErrors(document) {
  const errors = [];
  const itemIds = new Set();

  for (const section of clinicalSections) {
    for (const item of document[section] ?? []) {
      if (itemIds.has(item.item_id)) {
        errors.push(`duplicate item_id: ${item.item_id}`);
      }
      itemIds.add(item.item_id);

      const { start_ms: start, end_ms: end } = item.evidence ?? {};
      if (start !== undefined && end !== undefined && end < start) {
        errors.push(`${item.item_id}: evidence end_ms precedes start_ms`);
      }
    }
  }

  for (const flag of document.safety_flags ?? []) {
    for (const relatedId of flag.related_item_ids ?? []) {
      if (!itemIds.has(relatedId)) {
        errors.push(`${flag.flag_id}: unknown related_item_id ${relatedId}`);
      }
    }
  }

  for (const uncertainItem of document.uncertain_items ?? []) {
    for (const relatedId of uncertainItem.related_item_ids ?? []) {
      if (!itemIds.has(relatedId)) {
        errors.push(`${uncertainItem.item_id}: unknown related_item_id ${relatedId}`);
      }
    }
  }

  return errors;
}

async function fixtureNames(kind) {
  const directory = resolve(contractDirectory, "fixtures", kind);
  return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
}

async function loadFixture(kind, name) {
  return JSON.parse(
    await readFile(resolve(contractDirectory, "fixtures", kind, name), "utf8"),
  );
}

const validFixtures = await fixtureNames("valid");
const invalidFixtures = await fixtureNames("invalid");

assert.ok(validFixtures.length > 0, "At least one valid fixture is required");
assert.ok(invalidFixtures.length > 0, "At least one invalid fixture is required");

for (const name of validFixtures) {
  const document = await loadFixture("valid", name);
  assert.equal(
    validate(document),
    true,
    `${name} must satisfy the schema: ${JSON.stringify(validate.errors, null, 2)}`,
  );
  assert.deepEqual(
    semanticErrors(document),
    [],
    `${name} must satisfy cross-item invariants`,
  );
}

for (const name of invalidFixtures) {
  const document = await loadFixture("invalid", name);
  const schemaValid = validate(document);
  const crossItemValid = semanticErrors(document).length === 0;
  assert.equal(
    schemaValid && crossItemValid,
    false,
    `${name} is an invalid fixture but passed every validation`,
  );
}

console.log(
  `Clinical note schema validated ${validFixtures.length} valid fixtures and rejected ${invalidFixtures.length} invalid fixtures.`,
);
