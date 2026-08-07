import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const transcriptDirectory = resolve(repositoryRoot, "docs/sample-transcripts");
const evaluationDirectory = resolve(repositoryRoot, "docs/evaluation");
const expectedDirectory = resolve(evaluationDirectory, "expected-outputs");
const schemaPath = resolve(
  repositoryRoot,
  "docs/schemas/clinical-note-schema/v0.1.0/schema.json",
);

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

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const manifest = JSON.parse(
  await readFile(resolve(transcriptDirectory, "manifest.json"), "utf8"),
);
const expectations = JSON.parse(
  await readFile(resolve(evaluationDirectory, "case-expectations.json"), "utf8"),
);
const checklist = JSON.parse(
  await readFile(resolve(evaluationDirectory, "qa-checklist.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function parseTranscript(content) {
  const transcriptId = content.match(/^TRANSCRIPT_ID: (.+)$/m)?.[1];
  const transcriptVersion = content.match(/^TRANSCRIPT_VERSION: (.+)$/m)?.[1];
  const segments = new Map();
  const segmentPattern =
    /^\[([^ |]+) \| ([^ |]+) \| (doctor|patient|caregiver|clinic_staff|unknown)\] (?:Doctor|Patient|Caregiver|Clinic staff|Unknown): (.*)$/gm;

  for (const match of content.matchAll(segmentPattern)) {
    assert.ok(!segments.has(match[1]), `Duplicate transcript segment ${match[1]}`);
    segments.set(match[1], { timestamp: match[2], speaker: match[3], text: match[4] });
  }

  return { transcriptId, transcriptVersion, segments };
}

function assertExpectedOutputIntegrity(document, transcript, fileName) {
  assert.equal(
    validate(document),
    true,
    `${fileName} must satisfy the schema: ${JSON.stringify(validate.errors, null, 2)}`,
  );
  assert.equal(document.document_status, "ai_draft", `${fileName} must remain an AI draft`);
  assert.equal(document.source.transcript_id, transcript.transcriptId, `${fileName} transcript ID mismatch`);
  assert.equal(
    document.source.transcript_version,
    transcript.transcriptVersion,
    `${fileName} transcript version mismatch`,
  );

  const itemIds = new Set();
  for (const section of clinicalSections) {
    for (const item of document[section]) {
      assert.ok(!itemIds.has(item.item_id), `${fileName} duplicate item_id ${item.item_id}`);
      itemIds.add(item.item_id);

      const segment = transcript.segments.get(item.evidence.segment_id);
      assert.ok(segment, `${fileName} references unknown segment ${item.evidence.segment_id}`);
      assert.equal(
        item.evidence.speaker,
        segment.speaker,
        `${fileName} ${item.item_id} speaker does not match its transcript segment`,
      );
      assert.ok(
        segment.text.includes(item.source_quote),
        `${fileName} ${item.item_id} source_quote is not exact transcript text`,
      );
    }
  }

  for (const flag of document.safety_flags) {
    for (const relatedId of flag.related_item_ids ?? []) {
      assert.ok(itemIds.has(relatedId), `${fileName} ${flag.flag_id} has unknown related item ${relatedId}`);
    }
  }
}

const manifestIds = manifest.transcripts.map((item) => item.transcript_id).sort();
const expectedFiles = (await readdir(expectedDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const expectedIds = expectedFiles.map((name) => name.replace(/\.json$/, "")).sort();
const expectationIds = expectations.cases.map((item) => item.transcript_id).sort();

assert.equal(manifestIds.length, 10, "The benchmark must contain exactly ten transcripts");
assert.deepEqual(expectedIds, manifestIds, "Expected outputs must match the transcript manifest");
assert.deepEqual(expectationIds, manifestIds, "Case expectations must match the transcript manifest");

for (const manifestItem of manifest.transcripts) {
  const transcript = parseTranscript(
    await readFile(resolve(transcriptDirectory, manifestItem.file), "utf8"),
  );
  assert.equal(transcript.transcriptId, manifestItem.transcript_id, "Manifest transcript ID mismatch");
  assert.ok(transcript.segments.size > 0, `${manifestItem.transcript_id} must contain evidence segments`);

  const expectedFileName = `${manifestItem.transcript_id}.json`;
  const document = JSON.parse(
    await readFile(resolve(expectedDirectory, expectedFileName), "utf8"),
  );
  assertExpectedOutputIntegrity(document, transcript, expectedFileName);
}

const factIds = new Set();
for (const caseExpectation of expectations.cases) {
  for (const category of ["required", "optional", "forbidden"]) {
    assert.ok(
      Array.isArray(caseExpectation[category]) && caseExpectation[category].length > 0,
      `${caseExpectation.transcript_id} must define ${category} facts`,
    );
    for (const fact of caseExpectation[category]) {
      assert.ok(!factIds.has(fact.fact_id), `Duplicate expectation fact_id ${fact.fact_id}`);
      factIds.add(fact.fact_id);
      assert.ok(fact.paths.every((path) => path.startsWith("/")), `${fact.fact_id} has invalid paths`);
    }
  }
}

const checklistIds = new Set(checklist.checks.map((check) => check.check_id));
for (const requiredCheck of [
  "SCHEMA-001",
  "STATE-001",
  "EVIDENCE-001",
  "EVIDENCE-002",
  "SPEAKER-001",
  "NEGATION-001",
  "TIME-001",
  "DRUG-001",
  "DOSE-001",
  "FREQ-001",
  "OMISSION-001",
  "UNSUPPORTED-001",
  "UNCERTAINTY-001",
]) {
  assert.ok(checklistIds.has(requiredCheck), `QA checklist is missing ${requiredCheck}`);
}

console.log(
  `Clinical evaluation validated ${expectedFiles.length} expected outputs, ${factIds.size} classified facts, and ${checklistIds.size} QA checks.`,
);

