import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Work = { id: string; source_observation_correction_id: string | null; reconciliation_revision: number };

async function connect() {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function asDoctor<T>(client: Client, doctorId: string, work: () => Promise<T>) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function asService<T>(client: Client, work: () => Promise<T>) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
}

async function createCorrection(client: Client, doctorId: string, observationId: string, name: string, key: string) {
  return asDoctor(client, doctorId, async () => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM public.create_clinical_observation_correction($1, $2::text, jsonb_build_object('valueText', $2::text), NULL, NULL, 'unknown', NULL, $3::text)",
      [observationId, name, key],
    );
    return rows[0].id;
  });
}

async function claim(client: Client) {
  return asService(client, async () => {
    const { rows } = await client.query<Work>("SELECT id, source_observation_correction_id, reconciliation_revision FROM public.claim_clinical_state_reconciliation_work()");
    assert.equal(rows.length, 1, "expected a claimed reconciliation work item");
    return rows[0];
  });
}

async function finalize(client: Client, observationId: string, work: Work, displayName: string, fingerprint: string) {
  return client.query<{ id: string }>(
    `SELECT id FROM public.create_clinical_state_delta_for_claim(
      $1::uuid, NULL, 0, 'medication', 'possible_addition', NULL, NULL, $2::text,
      jsonb_build_object('displayName', $2::text, 'valueText', $2::text, 'regimenText', $2::text),
      'active', 'phase9-race/v1', $3::text, $4::uuid, $5::uuid, $6::bigint
    )`,
    [observationId, displayName, fingerprint, work.source_observation_correction_id, work.id, work.reconciliation_revision],
  );
}

async function complete(client: Client, workId: string) {
  await asService(client, () => client.query("SELECT public.complete_clinical_state_reconciliation_work($1)", [workId]));
}

async function insertObservation(client: Client, input: { clinicId: string; patientId: string; consultationId: string; doctorId: string; documentId: string; extractionId: string; observationId: string; itemIndex: number; displayName: string }) {
  await client.query(
    `INSERT INTO public.clinical_observations (
      id, clinic_id, patient_id, origin_patient_id, consultation_id, observation_type,
      normalized_key, display_name, normalized_value, source_document_id,
      source_extraction_id, source_item_index, source_page_number, source_evidence_text,
      confidence, effective_date_precision, effective_date_source
    ) VALUES ($1, $2, $3, $3, $4, 'medication', $5::text, $6::text, jsonb_build_object('valueText', $6::text), $7, $8, $9, 1, $6::text, 0.9, 'unknown', 'unknown')`,
    [input.observationId, input.clinicId, input.patientId, input.consultationId, input.displayName.toLowerCase().replaceAll(" ", "-"), input.displayName, input.documentId, input.extractionId, input.itemIndex],
  );
}

async function removeFixture(clinicId: string) {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "audit_logs", "preconsult_brief_views", "preconsult_brief_evidence_links", "preconsult_brief_start_snapshots", "preconsult_brief_current", "preconsult_brief_generation_work", "preconsult_brief_versions", "preconsult_brief_encounter_origins",
      "clinical_state_delta_dispositions", "confirmed_clinical_state_versions", "clinical_state_delta_evidence", "clinical_state_deltas", "clinical_state_reconciliation_work", "clinical_observation_corrections", "clinical_observations", "document_extractions", "documents", "patient_intake_statements", "consents", "patient_intakes", "clinical_notes", "consultations", "patients", "profiles", "clinics",
    ]) {
      await client.query(`DELETE FROM public.${table} WHERE ${table === "clinics" ? "id" : "clinic_id"} = $1`, [clinicId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

test("Phase 9 correction publication and finalization share one source lock across two sessions", async (t) => {
  const setup = await connect();
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const patientId = randomUUID();
  const consultationId = randomUUID();
  const intakeId = randomUUID();
  const documentId = randomUUID();
  const extractionId = randomUUID();
  const raceObservationId = randomUUID();
  const acceptObservationId = randomUUID();
  t.after(() => removeFixture(clinicId));

  await setup.query("INSERT INTO public.clinics (id, name) VALUES ($1, 'Phase 9 Race Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES ($1, $2, $3, 'Phase 9 Race Doctor', 'doctor')", [doctorId, clinicId, `phase9-race-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id, clinic_id, full_name) VALUES ($1, $2, 'Phase 9 Race Patient')", [patientId, clinicId]);
  await setup.query("INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES ($1, $2, $3, $4, 'draft', 'scheduled')", [consultationId, clinicId, patientId, doctorId]);
  await setup.query("INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status) VALUES ($1, $2, $3, $3, $4, 'not_started')", [intakeId, clinicId, patientId, consultationId]);
  await setup.query("INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES ($1, $2, $2, $3, $4, 'document_storage', 'phase9-race/v1', 'accepted', 'doctor')", [clinicId, patientId, consultationId, intakeId]);
  await setup.query(
    `INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date_source, document_date_precision)
     VALUES ($1, $2, $3, $3, $4, $5, $6, 'doctor', $7, repeat('a', 64), 'application/pdf', 100, 'race.pdf', 'lab_report', 'unknown', 'unknown')`,
    [documentId, clinicId, patientId, consultationId, intakeId, doctorId, `${clinicId}/${patientId}/${documentId}/race.pdf`],
  );
  await setup.query(
    `INSERT INTO public.document_extractions (id, clinic_id, document_id, requested_by_profile_id, attempt_number, schema_version, pipeline_version, provider, model_version, status, classification_type, classification_confidence, overall_confidence, document_identity_hash, completed_at)
     VALUES ($1, $2, $3, $4, 1, 'phase9-race/v1', 'phase9-race/v1', 'test', 'test', 'succeeded', 'lab_report', 0.9, 0.9, repeat('b', 64), now())`,
    [extractionId, clinicId, documentId, doctorId],
  );
  await insertObservation(setup, { clinicId, patientId, consultationId, doctorId, documentId, extractionId, observationId: raceObservationId, itemIndex: 0, displayName: "Race medicine" });
  await insertObservation(setup, { clinicId, patientId, consultationId, doctorId, documentId, extractionId, observationId: acceptObservationId, itemIndex: 1, displayName: "Accepted medicine" });
  await setup.query("UPDATE public.clinical_state_reconciliation_work SET status = 'completed', completed_at = now() WHERE source_observation_id = ANY($1::uuid[])", [[raceObservationId, acceptObservationId]]);
  await setup.end();

  const doctor = await connect();
  const worker = await connect();
  const finalizer = await connect();
  const correctionSession = await connect();
  try {
    const c1 = await createCorrection(doctor, doctorId, raceObservationId, "Race medicine C1", `race-c1-${randomUUID()}`);
    const c1Work = await claim(worker);
    assert.equal(c1Work.source_observation_correction_id, c1);

    // Session 1 has finished the real finalizer RPC but deliberately keeps the
    // transaction open at the common observation lock. Session 2 is therefore
    // genuinely concurrent and must wait before publishing C2.
    await finalizer.query("BEGIN");
    await finalizer.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    const c1Finalized = await finalize(finalizer, raceObservationId, c1Work, "Race medicine C1", randomUUID());
    const c1DeltaId = c1Finalized.rows[0].id;
    await correctionSession.query("BEGIN");
    await correctionSession.query("SET LOCAL ROLE authenticated");
    await correctionSession.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    const c2Pending = correctionSession.query<{ id: string }>(
      "SELECT id FROM public.create_clinical_observation_correction($1, $2::text, jsonb_build_object('valueText', $2::text), NULL, NULL, 'unknown', NULL, $3::text)",
      [raceObservationId, "Race medicine C2", `race-c2-${randomUUID()}`],
    );
    const stillBlocked = await Promise.race([c2Pending.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 125))]);
    assert.equal(stillBlocked, true, "C2 waits on the observation serialization boundary while C1 is uncommitted");
    await finalizer.query("COMMIT");
    const c2 = (await c2Pending).rows[0].id;
    await correctionSession.query("COMMIT");

    assert.equal((await worker.query("SELECT id FROM public.current_clinical_observation_corrections WHERE source_observation_id = $1", [raceObservationId])).rows[0].id, c2);
    assert.equal((await worker.query("SELECT disposition::text AS disposition FROM public.clinical_state_delta_dispositions WHERE delta_id = $1", [c1DeltaId])).rows[0].disposition, "stale");
    assert.equal((await worker.query("SELECT count(*)::int AS count FROM public.clinical_state_deltas d LEFT JOIN public.clinical_state_delta_dispositions x ON x.delta_id = d.id WHERE d.id = $1 AND x.id IS NULL", [c1DeltaId])).rows[0].count, 0);
    await assert.rejects(() => asDoctor(doctor, doctorId, () => doctor.query("SELECT * FROM public.decide_clinical_state_delta($1, 'accept', NULL, $2)", [c1DeltaId, `obsolete-accept-${randomUUID()}`])), (error: unknown) => errorCode(error) === "40901");
    assert.equal((await worker.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE patient_id = $1", [patientId])).rows[0].count, 0, "corrections do not autonomously confirm state");

    const c2Work = await claim(worker);
    assert.equal(c2Work.source_observation_correction_id, c2);
    const c2Finalized = await asService(worker, () => finalize(worker, raceObservationId, c2Work, "Race medicine C2", randomUUID()));
    await complete(worker, c2Work.id);
    const c2DeltaId = c2Finalized.rows[0].id;
    assert.equal((await worker.query("SELECT count(*)::int AS count FROM public.clinical_state_deltas d LEFT JOIN public.clinical_state_delta_dispositions x ON x.delta_id = d.id WHERE d.id IN ($1, $2) AND x.id IS NULL", [c1DeltaId, c2DeltaId])).rows[0].count, 1, "only C2 may remain actionable");

    const acceptedC1 = await createCorrection(doctor, doctorId, acceptObservationId, "Accepted medicine C1", `accept-c1-${randomUUID()}`);
    const acceptedWork = await claim(worker);
    assert.equal(acceptedWork.source_observation_correction_id, acceptedC1);
    const acceptedDelta = await asService(worker, () => finalize(worker, acceptObservationId, acceptedWork, "Accepted medicine C1", randomUUID()));
    await complete(worker, acceptedWork.id);
    const acceptedDeltaId = acceptedDelta.rows[0].id;
    const accepted = await asDoctor(doctor, doctorId, () => doctor.query<{ disposition: string }>("SELECT disposition::text AS disposition FROM public.decide_clinical_state_delta($1, 'accept', NULL, $2)", [acceptedDeltaId, `accept-first-${randomUUID()}`]));
    assert.equal(accepted.rows[0].disposition, "accepted");
    const acceptedC2 = await createCorrection(doctor, doctorId, acceptObservationId, "Accepted medicine C2", `accept-c2-${randomUUID()}`);
    assert.equal((await worker.query("SELECT disposition::text AS disposition FROM public.clinical_state_delta_dispositions WHERE delta_id = $1", [acceptedDeltaId])).rows[0].disposition, "accepted", "later correction preserves prior doctor acceptance");
    assert.equal((await worker.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE patient_id = $1", [patientId])).rows[0].count, 1, "later correction does not undo confirmed state");
    const acceptedC2Work = await claim(worker);
    assert.equal(acceptedC2Work.source_observation_correction_id, acceptedC2);
    const acceptedC2Delta = await asService(worker, () => finalize(worker, acceptObservationId, acceptedC2Work, "Accepted medicine C2", randomUUID()));
    assert.ok(acceptedC2Delta.rows[0].id, "a later correction can produce a new reviewable proposal");
  } finally {
    await Promise.all([doctor.end(), worker.end(), finalizer.end(), correctionSession.end()]);
  }
});
