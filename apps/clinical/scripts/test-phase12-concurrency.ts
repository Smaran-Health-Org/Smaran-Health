import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { completeDocumentRegistration, DocumentOriginalAlreadyExistsError } from "../src/lib/documents/ingest-workflow";
import type { DocumentListItem, RegisterDocumentInput } from "../src/lib/db/documents";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function credentialDigest() {
  return `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
}

async function connect() {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function asAnonOtp(client: Client, tokenHash: string, otpHash: string, verifiedSessionHash: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE anon");
    const { rows } = await client.query<{ result: string }>(
      "SELECT public.verify_patient_intake_otp($1, $2, $3) AS result",
      [tokenHash, otpHash, verifiedSessionHash]
    );
    await client.query("COMMIT");
    return rows[0].result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function asDoctorStart(client: Client, doctorId: string, appointmentId: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    await client.query("SELECT * FROM public.transition_appointment_queue($1, 'start_consultation')", [appointmentId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function asDoctorDirectStart(client: Client, doctorId: string, patientId: string, commandId: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    const { rows } = await client.query<{ id: string; created: boolean }>(
      "SELECT id, created FROM public.create_direct_consultation($1, $2)",
      [patientId, commandId]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function asDoctorRegisteredDocumentCount(
  client: Client,
  doctorId: string,
  consultationId: string,
  registration: RegisterDocumentInput
) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    const { rows } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.get_staff_registered_document(
        $1, $2, $3, $4, $5, $6, $7, $8::public.medical_document_type, $9::date, $10::public.document_date_precision
      )`,
      [
        consultationId,
        registration.registrationCommandId,
        registration.storagePath,
        registration.contentHash,
        registration.mimeType,
        registration.fileSize,
        registration.originalFilename,
        registration.documentType,
        registration.documentDate ?? null,
        registration.documentDatePrecision,
      ]
    );
    await client.query("COMMIT");
    return rows[0].count;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function asDoctorRegisterDocument(
  client: Client,
  doctorId: string,
  consultationId: string,
  registration: RegisterDocumentInput
) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM public.register_staff_document(
        $1, $2, $3, $4, $5, $6, $7, $8::public.medical_document_type, $9::date, $10::public.document_date_precision
      )`,
      [
        consultationId,
        registration.registrationCommandId,
        registration.storagePath,
        registration.contentHash,
        registration.mimeType,
        registration.fileSize,
        registration.originalFilename,
        registration.documentType,
        registration.documentDate ?? null,
        registration.documentDatePrecision,
      ]
    );
    await client.query("COMMIT");
    return rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function clean(clinicId: string) {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "audit_logs", "preconsult_brief_views", "preconsult_brief_start_snapshots", "document_extractions", "documents", "intake_access_sessions",
      "consents", "patient_intakes", "appointments", "consultations", "patients", "profiles", "clinics",
    ]) {
      await client.query(`DELETE FROM public.${table} WHERE ${table === "clinics" ? "id" : "clinic_id"} = $1`, [clinicId]);
    }
    await client.query("DELETE FROM storage.objects WHERE bucket_id = 'medical-documents' AND name LIKE $1", [`${clinicId}/%`]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

test("Phase 12 serializes concurrent OTP failures, queued starts, and same-command direct starts", async (t) => {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const patientId = randomUUID();
  const otpConsultationId = randomUUID();
  const startConsultationId = randomUUID();
  const otpAppointmentId = randomUUID();
  const startAppointmentId = randomUUID();
  const directStartCommandId = randomUUID();
  const otpIntakeId = randomUUID();
  const tokenHash = credentialDigest();
  const correctOtpHash = credentialDigest();
  const wrongOtpHash = credentialDigest();
  const setup = await connect();
  t.after(() => clean(clinicId));

  await setup.query("INSERT INTO public.clinics (id, name) VALUES ($1, 'Phase 12 Concurrency Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES ($1, $2, $3, 'Phase 12 Doctor', 'doctor')", [doctorId, clinicId, `phase12-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES ($1, $2, 'Phase 12 Patient', '+919999910099')", [patientId, clinicId]);
  await setup.query(
    "INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES ($1, $2, $3, $4, 'draft', 'scheduled'), ($5, $2, $3, $4, 'draft', 'scheduled')",
    [otpConsultationId, clinicId, patientId, doctorId, startConsultationId]
  );
  await setup.query(
    "INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', $4), ($6, $2, $3, $4, $7, now() + interval '1 day', $4)",
    [otpAppointmentId, clinicId, patientId, doctorId, otpConsultationId, startAppointmentId, startConsultationId]
  );
  await setup.query("INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status) VALUES ($1, $2, $3, $3, $4, 'not_started')", [otpIntakeId, clinicId, patientId, otpConsultationId]);
  await setup.query(
    `INSERT INTO public.intake_access_sessions (
      clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, appointment_id,
      token_hash, otp_hash, delivery_status, failed_attempts, max_attempts, expires_at, otp_expires_at, created_by
    ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, 'preview', 0, 3, now() + interval '1 hour', now() + interval '10 minutes', $8)`,
    [clinicId, patientId, otpConsultationId, otpIntakeId, otpAppointmentId, tokenHash, correctOtpHash, doctorId]
  );
  await setup.end();

  const otpClients = await Promise.all(Array.from({ length: 8 }, () => connect()));
  const startLeft = await connect();
  const startRight = await connect();
  const verifier = await connect();
  try {
    const outcomes = await Promise.all(otpClients.map((client, index) =>
      asAnonOtp(client, tokenHash, wrongOtpHash, `${credentialDigest().slice(0, 63)}${index.toString(16)}`)
    ));
    assert.equal(outcomes.filter((outcome) => outcome === "invalid_otp").length, 2);
    assert.equal(outcomes.filter((outcome) => outcome === "locked").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome === "invalid").length, 5);
    const lockState = await verifier.query<{ failed_attempts: number; invalidated: boolean }>(
      "SELECT failed_attempts, invalidated_at IS NOT NULL AS invalidated FROM public.intake_access_sessions WHERE token_hash = $1",
      [tokenHash]
    );
    assert.deepEqual(lockState.rows[0], { failed_attempts: 3, invalidated: true });
    assert.equal(await asAnonOtp(verifier, tokenHash, correctOtpHash, credentialDigest()), "invalid");

    await Promise.all([
      asDoctorStart(startLeft, doctorId, startAppointmentId),
      asDoctorStart(startRight, doctorId, startAppointmentId),
    ]);
    assert.equal((await verifier.query("SELECT count(*)::int AS count FROM public.preconsult_brief_start_snapshots WHERE consultation_id = $1", [startConsultationId])).rows[0].count, 1);
    assert.equal((await verifier.query("SELECT operational_status::text AS status FROM public.consultations WHERE id = $1", [startConsultationId])).rows[0].status, "in_consultation");
    assert.equal((await verifier.query("SELECT count(*)::int AS count FROM public.audit_logs WHERE action = 'consultation_started' AND resource_id = $1", [startConsultationId])).rows[0].count, 1);

    const [directLeft, directRight] = await Promise.all([
      asDoctorDirectStart(startLeft, doctorId, patientId, directStartCommandId),
      asDoctorDirectStart(startRight, doctorId, patientId, directStartCommandId),
    ]);
    assert.equal(directLeft.id, directRight.id);
    assert.deepEqual([directLeft.created, directRight.created].sort(), [false, true]);
    assert.equal((await verifier.query("SELECT count(*)::int AS count FROM public.consultations WHERE clinic_id = $1 AND doctor_id = $2 AND direct_start_command_id = $3", [clinicId, doctorId, directStartCommandId])).rows[0].count, 1);
    assert.equal((await verifier.query("SELECT operational_status::text AS status FROM public.consultations WHERE id = $1", [directLeft.id])).rows[0].status, "in_consultation");
    assert.equal((await verifier.query("SELECT count(*)::int AS count FROM public.audit_logs WHERE action = 'consultation.created' AND resource_id = $1", [directLeft.id])).rows[0].count, 1);
  } finally {
    await Promise.all([...otpClients, startLeft, startRight, verifier].map((client) => client.end()));
  }
});

test("Phase 12 retains an immutable original when another request registers the same stable document identity", async (t) => {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const patientId = randomUUID();
  const consultationId = randomUUID();
  const registrationCommandId = randomUUID();
  const storagePath = `${clinicId}/${patientId}/${registrationCommandId}/original.pdf`;
  const registration: RegisterDocumentInput = {
    registrationCommandId,
    storagePath,
    contentHash: "a".repeat(64),
    mimeType: "application/pdf",
    fileSize: 100,
    originalFilename: "phase12-race.pdf",
    documentType: "lab_report",
    documentDatePrecision: "unknown",
  };
  let registeredDocument: DocumentListItem | null = null;
  const registeredDocumentTemplate: Omit<DocumentListItem, "id"> = {
    originalFilename: registration.originalFilename,
    documentType: registration.documentType,
    documentDate: null,
    documentDateSource: "unknown",
    documentDatePrecision: "unknown",
    status: "uploaded",
    duplicateOfDocumentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    latestExtractionStatus: null,
    latestFailureReasonCode: null,
  };
  const setup = await connect();
  const lookupClient = await connect();
  const registerClient = await connect();
  t.after(() => clean(clinicId));

  await setup.query("INSERT INTO public.clinics (id, name) VALUES ($1, 'Phase 12 Document Race Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES ($1, $2, $3, 'Phase 12 Document Race Doctor', 'doctor')", [doctorId, clinicId, `phase12-document-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES ($1, $2, 'Phase 12 Document Race Patient', '+919999910199')", [patientId, clinicId]);
  await setup.query("INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES ($1, $2, $3, $4, 'draft', 'scheduled')", [consultationId, clinicId, patientId, doctorId]);
  // Request A has made its immutable object visible before registration.
  await setup.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('medical-documents', $1)", [storagePath]);
  await setup.end();

  let firstLookupReached!: () => void;
  const firstLookup = new Promise<void>((resolve) => { firstLookupReached = resolve; });
  let allowFailure!: () => void;
  const registrationFailure = new Promise<void>((resolve) => { allowFailure = resolve; });
  let lookupCount = 0;
  let storeCalls = 0;
  let verifyCalls = 0;

  try {
    const requestA = completeDocumentRegistration({
      registration,
      bytes: new TextEncoder().encode("%PDF-1.7"),
      async store() {
        storeCalls += 1;
        throw new DocumentOriginalAlreadyExistsError();
      },
      async lookupRegistered() {
        lookupCount += 1;
        const count = await asDoctorRegisteredDocumentCount(lookupClient, doctorId, consultationId, registration);
        if (lookupCount === 1) {
          assert.equal(count, 0);
          firstLookupReached();
          return null;
        }
        assert.equal(count, 1);
        return registeredDocument;
      },
      async verifyExisting() {
        verifyCalls += 1;
        return true;
      },
      async register() {
        await registrationFailure;
        throw new Error("Request A lost its registration response");
      },
    });

    await firstLookup;
    // Request B is an independent database client that commits the same stable identity.
    const requestB = asDoctorRegisterDocument(registerClient, doctorId, consultationId, registration);
    const [registeredId] = await Promise.all([requestB]);
    assert.notEqual(registeredId, registrationCommandId);
    registeredDocument = { id: registeredId, ...registeredDocumentTemplate };
    allowFailure();

    const result = await requestA;
    assert.deepEqual(result, { kind: "registered", document: registeredDocument });
    assert.equal(storeCalls, 1);
    assert.equal(verifyCalls, 1);
    assert.equal(lookupCount, 2);
    assert.equal((await lookupClient.query("SELECT count(*)::int AS count FROM public.documents WHERE clinic_id = $1 AND registration_command_id = $2", [clinicId, registrationCommandId])).rows[0].count, 1);
    assert.equal((await lookupClient.query("SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id = 'medical-documents' AND name = $1", [storagePath])).rows[0].count, 1);
  } finally {
    await Promise.all([lookupClient.end(), registerClient.end()]);
  }
});
