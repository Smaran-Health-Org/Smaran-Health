import assert from "node:assert/strict";
import test from "node:test";
import {
  isSimilarPatientName,
  patientNameSimilarity,
  patientPhoneMatchKeys,
} from "../lib/identity";
import { findPossiblePatientDuplicatesWithClient } from "../lib/db/patients";
import {
  mergePatientsWithClient,
  PatientMergeError,
} from "../lib/db/patient-merges";
import {
  createPatientRequestSchema,
  duplicatePatientQuerySchema,
  mergePatientsSchema,
} from "../lib/validation";

const CLINIC_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID = "30000000-0000-4000-8000-000000000001";
const CANONICAL_ID = "30000000-0000-4000-8000-000000000002";

test("India-aware phone matching treats common +91, zero-prefix, and national forms alike", () => {
  assert.deepEqual(patientPhoneMatchKeys("98765 43210").sort(), ["919876543210", "9876543210"]);
  assert.deepEqual(patientPhoneMatchKeys("+91 98765 43210").sort(), ["919876543210", "9876543210"]);
  assert.deepEqual(patientPhoneMatchKeys("09876543210").sort(), ["09876543210", "919876543210", "9876543210"]);
  assert.deepEqual(patientPhoneMatchKeys("12345"), ["12345"]);
});

test("name similarity supports formatting, token order, and conservative near matches", () => {
  assert.equal(patientNameSimilarity("Aarav Mehta", "aarav mehta"), 1);
  assert.equal(patientNameSimilarity("Mehta Aarav", "Aarav Mehta"), 0.99);
  assert.equal(isSimilarPatientName("Aarav Mehta", "Aarav Mehata"), true);
  assert.equal(isSimilarPatientName("Aarav Mehta", "Neha Sharma"), false);
});

test("duplicate lookup is clinic scoped, excludes merged sources, and requires name similarity", async () => {
  const calls: Array<[string, unknown]> = [];
  const rows = [
    {
      id: CANONICAL_ID,
      fullName: "Aarav Mehata",
      normalizedName: "aarav mehata",
      phone: "+91 98765 43210",
      dateOfBirth: "1990-01-01",
      age: null,
      gender: "Male",
      medicalRecordNumber: "MRN-1",
    },
    {
      id: SOURCE_ID,
      fullName: "Different Person",
      normalizedName: "different person",
      phone: "+91 98765 43210",
      dateOfBirth: null,
      age: 40,
      gender: null,
      medicalRecordNumber: null,
    },
  ];
  const query = {
    select() { return query; },
    eq(column: string, value: unknown) { calls.push([`eq:${column}`, value]); return query; },
    is(column: string, value: unknown) { calls.push([`is:${column}`, value]); return query; },
    in(column: string, value: unknown) { calls.push([`in:${column}`, value]); return query; },
    async limit(value: number) { calls.push(["limit", value]); return { data: rows, error: null }; },
  };
  const client = { from: () => query } as unknown as Parameters<
    typeof findPossiblePatientDuplicatesWithClient
  >[0];

  const matches = await findPossiblePatientDuplicatesWithClient(client, CLINIC_ID, {
    fullName: "Aarav Mehta",
    phone: "9876543210",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, CANONICAL_ID);
  assert.deepEqual(calls[0], ["eq:clinic_id", CLINIC_ID]);
  assert.deepEqual(calls[1], ["is:merged_into_patient_id", null]);
  assert.deepEqual(calls[2], ["in:normalized_phone", ["9876543210", "919876543210"]]);
});

test("patient create and merge validation require explicit override/reason values", () => {
  assert.equal(createPatientRequestSchema.safeParse({ fullName: "A", duplicateOverride: "yes" }).success, false);
  assert.equal(createPatientRequestSchema.safeParse({ fullName: "A", duplicateOverride: "confirmed_distinct_patient" }).success, true);
  assert.equal(duplicatePatientQuerySchema.safeParse({ fullName: "A", phone: "123" }).success, false);
  assert.equal(mergePatientsSchema.safeParse({ canonicalPatientId: CANONICAL_ID }).success, true);
});

test("merge service delegates exactly one transactional RPC", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: [{
          id: "40000000-0000-4000-8000-000000000001",
          clinic_id: CLINIC_ID,
          source_patient_id: SOURCE_ID,
          canonical_patient_id: CANONICAL_ID,
          merged_by: "20000000-0000-4000-8000-000000000001",
          reason: "confirmed_duplicate",
          created_at: "2026-08-30T10:00:00Z",
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof mergePatientsWithClient>[0];

  const result = await mergePatientsWithClient(
    client,
    SOURCE_ID,
    CANONICAL_ID,
    "confirmed_duplicate"
  );
  assert.equal(rpcName, "merge_patients");
  assert.deepEqual(rpcArgs, {
    p_source_patient_id: SOURCE_ID,
    p_canonical_patient_id: CANONICAL_ID,
    p_reason: "confirmed_duplicate",
  });
  assert.equal(result.canonicalPatientId, CANONICAL_ID);
});

test("merge service maps authorization failures without exposing database details", async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: "Patient merge is not authorized for this role" } };
    },
  } as unknown as Parameters<typeof mergePatientsWithClient>[0];

  await assert.rejects(
    mergePatientsWithClient(client, SOURCE_ID, CANONICAL_ID, "confirmed_duplicate"),
    (error: unknown) => error instanceof PatientMergeError && error.kind === "forbidden"
  );
});
