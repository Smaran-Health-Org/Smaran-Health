import assert from "node:assert/strict";
import test from "node:test";
import {
  CLINICAL_PATIENT_FIELDS,
  PATIENT_DIRECTORY_COLUMNS,
  toPatientDirectoryEntry,
} from "../lib/db/patients";
import { updatePatientSchema } from "../lib/validation";
import type { Patient } from "../types";

function buildPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clinicId: "22222222-2222-4222-8222-222222222222",
    fullName: "Ananya Sharma",
    normalizedName: "ananya sharma",
    age: 43,
    dateOfBirth: "1983-04-12",
    gender: "Female",
    phone: "+91 98765 43210",
    normalizedPhone: "+919876543210",
    email: "ananya@example.test",
    normalizedEmail: "ananya@example.test",
    address: "Pune",
    medicalRecordNumber: "MRN-1",
    weightKg: 71.5,
    heightCm: 162,
    bloodPressure: "138/88",
    bloodGroup: "B+",
    hasDiabetes: true,
    primaryDoctorId: "33333333-3333-4333-8333-333333333333",
    mergedIntoPatientId: null,
    mergedAt: null,
    mergedBy: null,
    createdAt: new Date("2026-01-05T04:00:00.000Z"),
    updatedAt: new Date("2026-01-06T04:00:00.000Z"),
    ...overrides,
  };
}

test("the operational directory projection never selects clinical columns", () => {
  for (const column of ["weight_kg", "height_cm", "blood_pressure", "blood_group", "has_diabetes"]) {
    assert.equal(
      PATIENT_DIRECTORY_COLUMNS.includes(column),
      false,
      `${column} must not be requested for an operational surface`
    );
  }
  for (const column of ["full_name", "phone", "email", "date_of_birth", "gender", "medical_record_number", "created_at"]) {
    assert.equal(
      PATIENT_DIRECTORY_COLUMNS.includes(column),
      true,
      `${column} is identity data and must remain available`
    );
  }
});

test("stripping clinical facts keeps every identity field intact", () => {
  const entry = toPatientDirectoryEntry(buildPatient());

  for (const field of CLINICAL_PATIENT_FIELDS) {
    assert.equal(field in entry, false, `${field} leaked into an operational payload`);
  }

  assert.deepEqual(entry, {
    id: "11111111-1111-4111-8111-111111111111",
    clinicId: "22222222-2222-4222-8222-222222222222",
    fullName: "Ananya Sharma",
    normalizedName: "ananya sharma",
    age: 43,
    dateOfBirth: "1983-04-12",
    gender: "Female",
    phone: "+91 98765 43210",
    normalizedPhone: "+919876543210",
    email: "ananya@example.test",
    normalizedEmail: "ananya@example.test",
    address: "Pune",
    medicalRecordNumber: "MRN-1",
    primaryDoctorId: "33333333-3333-4333-8333-333333333333",
    mergedIntoPatientId: null,
    mergedAt: null,
    mergedBy: null,
    createdAt: new Date("2026-01-05T04:00:00.000Z"),
    updatedAt: new Date("2026-01-06T04:00:00.000Z"),
  });
});

test("the update schema still admits clinical fields, so the role guard is load-bearing", () => {
  // If the schema ever stopped accepting these, the PATCH guard would be a no-op
  // and this test should be revisited rather than left silently passing.
  const parsed = updatePatientSchema.safeParse({
    weightKg: 71.5,
    heightCm: 162,
    bloodPressure: "138/88",
    bloodGroup: "B+",
    hasDiabetes: true,
  });
  assert.equal(parsed.success, true);

  for (const field of CLINICAL_PATIENT_FIELDS) {
    assert.equal(
      field in (parsed.success ? parsed.data : {}),
      true,
      `${field} must be visible to the role check in PATCH /api/patients/[id]`
    );
  }

  // Identity edits from the Clinic Desk stay permitted, and unmatched keys are
  // dropped by the schema rather than reaching the update statement.
  const identityOnly = updatePatientSchema.safeParse({ age: 44, gender: "Female", email: "a@b.test" });
  assert.equal(identityOnly.success, true);
  const identityData = identityOnly.success ? identityOnly.data : {};
  assert.equal(CLINICAL_PATIENT_FIELDS.some((field) => field in identityData), false);
  assert.equal(identityData.age, 44);
});
