import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAppointmentWithClient,
  updateAppointmentStatusWithClient,
} from "../lib/db/appointments";
import {
  normalizePatientName,
  normalizePatientPhone,
} from "../lib/identity";
import {
  createAppointmentSchema,
  createPatientSchema,
  updateAppointmentSchema,
} from "../lib/validation";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DOCTOR_ID = "22222222-2222-4222-8222-222222222222";
const CLINIC_ID = "33333333-3333-4333-8333-333333333333";
const CONSULTATION_ID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_ID = "55555555-5555-4555-8555-555555555555";
const SCHEDULED_AT = "2026-09-01T10:00:00+05:30";

test("patient matching signals normalize formatting without inferring a country code", () => {
  assert.equal(normalizePatientPhone("+91 98765-43210"), "919876543210");
  assert.equal(normalizePatientPhone("98765 43210"), "9876543210");
  assert.equal(normalizePatientPhone("  "), null);
  assert.equal(normalizePatientName("  Aarav   MEHTA "), "aarav mehta");
});

test("patient validation accepts DOB and rejects impossible or future dates", () => {
  assert.equal(
    createPatientSchema.safeParse({
      fullName: "Synthetic Patient",
      dateOfBirth: "1990-02-28",
    }).success,
    true
  );
  assert.equal(
    createPatientSchema.safeParse({
      fullName: "Synthetic Patient",
      dateOfBirth: "1990-02-31",
    }).success,
    false
  );
  assert.equal(
    createPatientSchema.safeParse({
      fullName: "Synthetic Patient",
      dateOfBirth: "2999-01-01",
    }).success,
    false
  );
});

test("appointment validation requires a patient and scheduled timestamp", () => {
  const valid = createAppointmentSchema.safeParse({
    patientId: PATIENT_ID,
    doctorId: DOCTOR_ID,
    scheduledAt: SCHEDULED_AT,
    idempotencyKey: " booking-1 ",
  });
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.idempotencyKey, "booking-1");

  assert.equal(
    createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      doctorId: DOCTOR_ID,
      scheduledAt: SCHEDULED_AT,
      durationMinutes: 7,
    }).success,
    true
  );
  assert.equal(
    createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      doctorId: DOCTOR_ID,
      scheduledAt: SCHEDULED_AT,
      durationMinutes: 4,
    }).success,
    false
  );

  assert.equal(
    createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      scheduledAt: "not-a-date",
    }).success,
    false
  );
  assert.equal(updateAppointmentSchema.safeParse({ status: "no_show" }).success, true);
  assert.equal(updateAppointmentSchema.safeParse({ status: "processing" }).success, false);
});

test("appointment creation delegates one atomic, idempotent RPC call", async () => {
  let rpcName: string | undefined;
  let rpcArgs: Record<string, unknown> | undefined;
  const row = {
    id: APPOINTMENT_ID,
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    doctor_id: DOCTOR_ID,
    consultation_id: CONSULTATION_ID,
    scheduled_at: SCHEDULED_AT,
    status: "scheduled" as const,
    idempotency_key: "booking-1",
    duration_minutes: 7,
    appointment_type_id: null,
    staff_note: "staff-only scheduling note",
    creation_request: {},
    creation_request_fingerprint: "a".repeat(64),
    created_by: DOCTOR_ID,
    created_at: "2026-08-30T10:00:00.000Z",
    updated_at: "2026-08-30T10:00:00.000Z",
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcName = name;
      rpcArgs = args;
      return { data: [row], error: null };
    },
  } as unknown as Parameters<typeof createAppointmentWithClient>[0];

  const appointment = await createAppointmentWithClient(client, {
    patientId: PATIENT_ID,
    doctorId: DOCTOR_ID,
    scheduledAt: SCHEDULED_AT,
    staffNote: "staff-only scheduling note",
    durationMinutes: 7,
    idempotencyKey: "booking-1",
  });

  assert.equal(rpcName, "create_appointment_with_consultation_v2");
  assert.deepEqual(rpcArgs, {
    p_patient_id: PATIENT_ID,
    p_doctor_id: DOCTOR_ID,
    p_scheduled_at: SCHEDULED_AT,
    p_appointment_type_id: null,
    p_staff_note: "staff-only scheduling note",
    p_duration_minutes: 7,
    p_idempotency_key: "booking-1",
  });
  assert.equal(appointment.consultationId, CONSULTATION_ID);
  assert.equal(appointment.status, "scheduled");
  assert.equal(appointment.durationMinutes, 7);
});

test("cancelled and no-show updates touch appointments only", async () => {
  const touchedTables: string[] = [];
  let updatePayload: Record<string, unknown> | undefined;
  const appointment = {
    id: APPOINTMENT_ID,
    clinicId: CLINIC_ID,
    patientId: PATIENT_ID,
    doctorId: DOCTOR_ID,
    consultationId: CONSULTATION_ID,
    scheduledAt: SCHEDULED_AT,
    status: "cancelled" as const,
    idempotencyKey: null,
    createdBy: DOCTOR_ID,
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
  };
  const query = {
    update(payload: Record<string, unknown>) {
      updatePayload = payload;
      return query;
    },
    eq() {
      return query;
    },
    select() {
      return query;
    },
    async single() {
      return { data: { ...appointment, status: updatePayload?.status }, error: null };
    },
  };
  const client = {
    from(table: string) {
      touchedTables.push(table);
      return query;
    },
  } as unknown as Parameters<typeof updateAppointmentStatusWithClient>[0];

  for (const status of ["cancelled", "no_show"] as const) {
    const result = await updateAppointmentStatusWithClient(
      client,
      APPOINTMENT_ID,
      status,
      CLINIC_ID
    );
    assert.equal(result.status, status);
  }

  assert.deepEqual(touchedTables, ["appointments", "appointments"]);
  assert.equal(updatePayload?.status, "no_show");
  assert.equal("consultation_status" in (updatePayload ?? {}), false);
});

test("migration keeps name and phone as non-unique clinic-scoped signals", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/0005_preconsult_phase1_foundation.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /patients_clinic_normalized_phone_idx/);
  assert.match(migration, /patients_clinic_normalized_name_idx/);
  assert.doesNotMatch(migration, /UNIQUE\s*\([^)]*normalized_phone/i);
  assert.match(migration, /ALTER TABLE public\.appointments ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /create_appointment_with_consultation/);
});
