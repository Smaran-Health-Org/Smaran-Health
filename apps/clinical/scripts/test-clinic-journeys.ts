import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mock, test } from "node:test";
import { createRequire } from "node:module";
import type { SessionContext } from "../src/types";
import type {
  DocumentListItem,
  RegisterDocumentInput,
} from "../src/lib/db/documents";
import type { ClaimedDocumentProcessing } from "../src/lib/documents/process";
import { scope, pgClient, connect, type QaScope } from "./qa/pg-client";
import {
  completeDocumentRegistration,
  DocumentOriginalAlreadyExistsError,
} from "../src/lib/documents/ingest-workflow";
const require = createRequire(import.meta.url);
const next = require("next/server") as typeof import("next/server");
const modules = mock as unknown as {
  module: (
    id: string,
    options: {
      namedExports?: Record<string, unknown>;
      defaultExport?: unknown;
    },
  ) => void;
};
// scripts/qa/tsconfig.json matches Next's server-only marker alias.
modules.module("next/server", {
  namedExports: {
    NextRequest: next.NextRequest,
    NextResponse: next.NextResponse,
    after: () => undefined,
  },
});
modules.module(new URL("../src/lib/db/session.ts", import.meta.url).href, {
  namedExports: {
    getSessionContext: async () => scope.getStore()?.session ?? null,
  },
});
modules.module(new URL("../src/lib/supabase/server.ts", import.meta.url).href, {
  namedExports: { createClient: async () => pgClient() },
});
modules.module(
  new URL("../src/lib/supabase/service-role.ts", import.meta.url).href,
  {
    namedExports: {
      createServiceRoleClient: () =>
        pgClient({ session: null, role: "service_role" }),
    },
  },
);
modules.module(
  new URL("../src/lib/intake/verified-session.ts", import.meta.url).href,
  {
    namedExports: {
      verifiedIntakeCredentials: async (token: string) =>
        token === "fixture-token" && scope.getStore()?.intakeHash
          ? {
              tokenHash: scope.getStore()!.intakeHash,
              verifiedSessionHash: scope.getStore()!.intakeHash,
            }
          : null,
      createLinkSessionCredentials: async () => null,
    },
  },
);
const originals = new Map<string, Uint8Array>();
modules.module(
  new URL("../src/lib/documents/storage.ts", import.meta.url).href,
  {
    namedExports: {
      downloadDocumentOriginal: async (path: string) => {
        const bytes = originals.get(path);
        if (!bytes) throw new Error("Synthetic source missing");
        return bytes;
      },
    },
  },
);

async function handlers() {
  return {
    booking: await import("../src/app/api/appointments/route"),
    appointmentEdit: await import("../src/app/api/appointments/[id]/route"),
    patients: await import("../src/app/api/patients/route"),
    walkIns: await import("../src/app/api/walk-ins/route"),
    consultations: await import("../src/app/api/consultations/route"),
    note: await import("../src/app/api/consultations/[id]/note/route"),
    queue: await import("../src/app/api/appointments/[id]/queue/route"),
    intake: await import("../src/app/api/intake/[token]/route"),
    memory: await import("../src/lib/db/follow-up-memory"),
    appointments: await import("../src/lib/db/appointments"),
    intakeDb: await import("../src/lib/db/patient-intake"),
    documents: await import("../src/lib/db/documents"),
    process: await import("../src/lib/documents/process"),
  };
}
type Routes = Awaited<ReturnType<typeof handlers>>;
const noteContent = (summary: string) => ({
  summary,
  chiefComplaint: "",
  medicationChanges: "",
  investigations: "",
  followUpPlan: "",
  patientInstructions: "",
  uncertainItems: "",
});
const extraction = {
  documentType: "lab_report",
  classificationConfidence: 0.99,
  readabilityConfidence: 0.99,
  isHandwritten: false,
  isPartiallyUnreadable: false,
  documentDate: "2026-10-14",
  documentDateConfidence: 0.99,
  reportIdentifier: "SYNTHETIC-QA",
  reportIdentifierConfidence: 0.99,
  pages: [{ pageNumber: 1, text: "Synthetic evidence only", confidence: 0.99 }],
  uncertainItems: [],
  normalizedObservations: [],
};

type Fixture = {
  clinic: string;
  foreignClinic: string;
  doctor: SessionContext;
  assistant: SessionContext;
  foreignDoctor: SessionContext;
};
async function fixture(t: {
  after: (callback: () => Promise<void>) => void;
}): Promise<Fixture> {
  const clinic = randomUUID();
  const foreignClinic = randomUUID();
  const session = (
    id: string,
    clinicId: string,
    role: SessionContext["role"],
  ): SessionContext => ({
    userId: id,
    profileId: id,
    clinicId,
    role,
    email: `synthetic-${id}@example.invalid`,
    fullName: "Synthetic QA staff",
  });
  const f = {
    clinic,
    foreignClinic,
    doctor: session(randomUUID(), clinic, "doctor"),
    assistant: session(randomUUID(), clinic, "assistant"),
    foreignDoctor: session(randomUUID(), foreignClinic, "doctor"),
  };
  t.after(async () => {
    const c = await connect();
    try {
      await c.query("BEGIN; SET LOCAL session_replication_role=replica");
      await c.query("DELETE FROM storage.objects WHERE name LIKE $1", [
        clinic + "/%",
      ]);
      const tables = await c.query<{ table_name: string }>(
        "SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema='public' AND c.column_name='clinic_id' AND t.table_type='BASE TABLE'",
      );
      for (const row of tables.rows)
        await c.query(
          `DELETE FROM public."${row.table_name.replaceAll('"', '""')}" WHERE clinic_id=ANY($1::uuid[])`,
          [[clinic, foreignClinic]],
        );
      await c.query("DELETE FROM public.clinics WHERE id=ANY($1::uuid[])", [
        [clinic, foreignClinic],
      ]);
      await c.query("COMMIT");
      for (const path of originals.keys())
        if (path.startsWith(clinic + "/")) originals.delete(path);
    } finally {
      await c.end();
    }
  });
  const c = await connect();
  try {
    await c.query(
      "INSERT INTO public.clinics(id,name) VALUES($1,'Synthetic QA Clinic'),($2,'Synthetic QA Foreign')",
      [clinic, foreignClinic],
    );
    for (const s of [f.doctor, f.assistant, f.foreignDoctor])
      await c.query(
        "INSERT INTO public.profiles(id,clinic_id,email,full_name,role) VALUES($1,$2,$3,$4,$5)",
        [s.profileId, s.clinicId, s.email, s.fullName, s.role],
      );
    await c.query(
      "INSERT INTO public.doctor_working_hours(clinic_id,doctor_id,weekday,start_time,end_time) SELECT $1,$2,n,'09:00','17:00' FROM generate_series(0,6)n",
      [clinic, f.doctor.profileId],
    );
  } finally {
    await c.end();
  }
  return f;
}
const auth = (session: SessionContext): QaScope => ({
  session,
  role: "authenticated",
});
async function request(
  context: QaScope,
  method: string,
  path: string,
  body: unknown,
  handler: (r: import("next/server").NextRequest) => Promise<Response>,
) {
  return scope.run(context, async () => {
    const r = await handler(
      new next.NextRequest("http://qa.local" + path, {
        method,
        ...(method !== "GET"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      }),
    );
    return { status: r.status, body: await r.json(), headers: r.headers };
  });
}
async function scalar(sql: string, params: unknown[] = []) {
  const c = await connect();
  try {
    return (await c.query(sql, params)).rows[0];
  } finally {
    await c.end();
  }
}
async function newPatient(
  h: Routes,
  f: Fixture,
  name = "Synthetic QA Patient",
) {
  const r = await request(
    auth(f.assistant),
    "POST",
    "/api/patients",
    {
      fullName: name,
      phone: "+919900001234",
      email: "synthetic-patient@example.invalid",
    },
    h.patients.POST,
  );
  assert.equal(r.status, 201);
  return r.body as { id: string };
}
async function walkIn(h: Routes, f: Fixture, patientId: string, key: string) {
  return request(
    auth(f.assistant),
    "POST",
    "/api/walk-ins",
    { patientId, doctorId: f.doctor.profileId, idempotencyKey: key },
    h.walkIns.POST,
  );
}
async function review(
  h: Routes,
  f: Fixture,
  visit: string,
  status: "edited" | "approved",
  summary: string,
  revision: number | null,
) {
  return request(
    auth(f.doctor),
    "POST",
    `/api/consultations/${visit}/note`,
    {
      status,
      content: noteContent(summary),
      summary,
      expectedRevision: revision,
    },
    (r) => h.note.POST(r, { params: Promise.resolve({ id: visit }) }),
  );
}
async function registerDocument(
  h: Routes,
  f: Fixture,
  visit: string,
  patientId: string,
  lostResponse = false,
) {
  const command = randomUUID();
  const bytes = Buffer.from("%PDF-1.4\nSynthetic evidence only\n%%EOF");
  const registration: RegisterDocumentInput = {
    registrationCommandId: command,
    storagePath: `${f.clinic}/${patientId}/${command}/original.pdf`,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "application/pdf",
    fileSize: bytes.length,
    originalFilename: "synthetic.pdf",
    documentType: "lab_report",
    documentDate: "2026-10-14",
    documentDatePrecision: "exact",
  };
  const context = auth(f.assistant);
  const result = await completeDocumentRegistration({
    registration,
    bytes,
    store: async (input) => {
      if (originals.has(input.storagePath))
        throw new DocumentOriginalAlreadyExistsError();
      originals.set(input.storagePath, Uint8Array.from(input.bytes));
      const c = await connect();
      try {
        await c.query(
          "INSERT INTO storage.objects(bucket_id,name) VALUES('medical-documents',$1)",
          [input.storagePath],
        );
      } finally {
        await c.end();
      }
    },
    register: async (input) => {
      const saved = await h.documents.registerStaffDocumentWithClient(
        pgClient(context) as never,
        visit,
        input,
      );
      if (lostResponse) throw new Error("Synthetic lost registration response");
      return saved;
    },
    lookupRegistered: (input) =>
      h.documents.getStaffRegisteredDocumentWithClient(
        pgClient(context) as never,
        visit,
        input,
      ),
    verifyExisting: async () => true,
  });
  assert.equal(result.kind, "registered");
  return {
    document: (result as { document: DocumentListItem }).document,
    registration,
    bytes,
  };
}
async function claim() {
  const result = await pgClient({ session: null, role: "service_role" }).rpc(
    "claim_document_processing_work",
    {
      p_schema_version: "medical-document-extraction/v1",
      p_pipeline_version: "qa/v1",
      p_provider: "mock",
      p_model_version: "mock",
    },
  );
  assert.equal(result.error, null);
  const row = (result.data as ClaimedDocumentProcessing[])[0];
  assert.ok(row);
  return row;
}

test("synthetic new-patient journey: desk registration, walk-in, direct-link intake, document, manual review, approval and memory", async (t) => {
  const f = await fixture(t);
  const h = await handlers();
  const patient = await newPatient(h, f);
  const duplicate = await request(
    auth(f.assistant),
    "POST",
    "/api/patients",
    { fullName: "Synthetic QA Patient", phone: "+919900001234" },
    h.patients.POST,
  );
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "possible_duplicate");
  const visit = await walkIn(h, f, patient.id, "qa-journey-walk-in");
  assert.equal(visit.status, 201);
  const { appointmentId, consultationId } = visit.body;
  const issued = await h.intakeDb.issuePatientIntakeAccessWithClient(
    pgClient(auth(f.assistant)) as never,
    {
      appointmentId,
      tokenHash: "a".repeat(64),
      otpHash: "b".repeat(64),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      otpExpiresAt: new Date(Date.now() + 600000).toISOString(),
    },
  );
  await h.intakeDb.markPatientIntakeDeliveryWithClient(
    pgClient(auth(f.assistant)) as never,
    issued.accessSessionId,
    "preview",
  );
  const patientContext: QaScope = {
    session: null,
    role: "anon",
    intakeHash: "a".repeat(64),
  };
  assert.equal(
    await h.intakeDb.verifyPatientIntakeOtpWithClient(
      pgClient(patientContext) as never,
      {
        tokenHash: "a".repeat(64),
        otpHash: "a".repeat(64),
        verifiedSessionHash: "a".repeat(64),
      },
    ),
    "verified",
  );
  const opened = await request(
    patientContext,
    "GET",
    "/api/intake/fixture-token",
    null,
    (r) =>
      h.intake.GET(r, { params: Promise.resolve({ token: "fixture-token" }) }),
  );
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get("cache-control"), "no-store");
  const intakeBody = {
    consentAccepted: true,
    consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "Synthetic patient verbatim reason",
    conditions: [],
    medications: [],
    allergies: [],
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(
          patientContext,
          "POST",
          "/api/intake/fixture-token",
          intakeBody,
          (r) =>
            h.intake.POST(r, {
              params: Promise.resolve({ token: "fixture-token" }),
            }),
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM public.audit_logs WHERE action='intake_submitted' AND resource_id=$1",
        [issued.patientIntakeId],
      )
    ).n,
    1,
  );
  const original = await registerDocument(
    h,
    f,
    consultationId,
    patient.id,
    true,
  );
  const work = await claim();
  assert.equal(work.document_id, original.document.id);
  assert.equal(
    await h.process.processClaimedMedicalDocument(work, {
      provider: "mock",
      modelVersion: "mock",
      process: async () => extraction,
    }),
    true,
  );
  assert.equal(
    (
      await scalar("SELECT status FROM public.documents WHERE id=$1", [
        original.document.id,
      ])
    ).status,
    "processed",
  );
  const start = () =>
    request(
      auth(f.doctor),
      "PATCH",
      `/api/appointments/${appointmentId}/queue`,
      { operation: "start_consultation" },
      (r) =>
        h.queue.PATCH(r, { params: Promise.resolve({ id: appointmentId }) }),
    );
  assert.equal((await start()).status, 200);
  assert.equal((await start()).status, 200);
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM public.preconsult_brief_start_snapshots WHERE consultation_id=$1",
        [consultationId],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await scope.run(auth(f.doctor), () =>
        h.memory.getFollowUpMemory(patient.id, f.clinic),
      )
    ).approvedCount,
    0,
  );
  const edited = await review(
    h,
    f,
    consultationId,
    "edited",
    "Synthetic doctor-authored note",
    null,
  );
  assert.equal(edited.status, 201);
  const denied = await request(
    auth(f.assistant),
    "POST",
    `/api/consultations/${consultationId}/note`,
    {
      status: "approved",
      content: noteContent("Unauthorized"),
      summary: "Unauthorized",
      expectedRevision: 1,
    },
    (r) => h.note.POST(r, { params: Promise.resolve({ id: consultationId }) }),
  );
  assert.equal(denied.status, 403);
  const approved = await review(
    h,
    f,
    consultationId,
    "approved",
    "Synthetic doctor-authored note",
    edited.body.note.revision,
  );
  assert.equal(approved.status, 201);
  assert.equal(
    (
      await review(
        h,
        f,
        consultationId,
        "approved",
        "Synthetic doctor-authored note",
        edited.body.note.revision,
      )
    ).body.note.id,
    approved.body.note.id,
  );
  const memory = await scope.run(auth(f.doctor), () =>
    h.memory.getFollowUpMemory(patient.id, f.clinic),
  );
  assert.equal(memory.approvedCount, 1);
  assert.equal(memory.summary, "Synthetic doctor-authored note");
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM public.patient_timeline_events WHERE clinical_note_id=$1",
        [approved.body.note.id],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await scalar("SELECT status FROM public.appointments WHERE id=$1", [
        appointmentId,
      ])
    ).status,
    "completed",
  );
  assert.deepEqual(
    originals.get(original.registration.storagePath),
    Uint8Array.from(original.bytes),
  );
});

test("interrupted direct start and note save recover without duplicate visits, and failed document processing does not block care", async (t) => {
  const f = await fixture(t);
  const h = await handlers();
  const patient = await newPatient(h, f);
  const commandId = randomUUID();
  const direct = () =>
    request(
      auth(f.doctor),
      "POST",
      "/api/consultations",
      { patientId: patient.id, commandId },
      h.consultations.POST,
    );
  const first = await direct();
  assert.equal(first.status, 201);
  const retry = await direct();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, first.body.id);
  const saved = await review(
    h,
    f,
    first.body.id,
    "edited",
    "Synthetic recovered manual note",
    null,
  );
  assert.equal(saved.status, 201);
  const savedRetry = await review(
    h,
    f,
    first.body.id,
    "edited",
    "Synthetic recovered manual note",
    null,
  );
  assert.equal(savedRetry.body.note.id, saved.body.note.id);
  // Direct-start has no appointment intake UI; set up explicit, fictional
  // doctor-captured document consent before testing processing failure.
  const intake = await scalar(
    "INSERT INTO public.patient_intakes(clinic_id,patient_id,origin_patient_id,consultation_id,status) VALUES($1,$2,$2,$3,'in_progress') RETURNING id",
    [f.clinic, patient.id, first.body.id],
  );
  await scalar(
    "INSERT INTO public.consents(clinic_id,patient_id,origin_patient_id,consultation_id,patient_intake_id,consent_type,version,status,captured_via) VALUES($1,$2,$2,$3,$4,'document_storage','preconsult-intake-consent/v1.0','accepted','doctor') RETURNING id",
    [f.clinic, patient.id, first.body.id, intake.id],
  );
  const doc = await registerDocument(h, f, first.body.id, patient.id);
  const work = await claim();
  await assert.rejects(() =>
    h.process.processClaimedMedicalDocument(work, {
      provider: "mock",
      modelVersion: "mock",
      process: async () => {
        throw new Error("Synthetic provider unavailable");
      },
    }),
  );
  const fail = await pgClient({ session: null, role: "service_role" }).rpc(
    "fail_document_processing_work",
    {
      p_work_id: work.work_id,
      p_extraction_id: work.extraction_id,
      p_failure_code: "provider_unavailable",
    },
  );
  assert.equal(fail.error, null);
  assert.equal(
    (
      await review(
        h,
        f,
        first.body.id,
        "approved",
        "Synthetic recovered manual note",
        saved.body.note.revision,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await scalar(
        "SELECT count(*)::int n FROM public.consultations WHERE patient_id=$1",
        [patient.id],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await scalar("SELECT count(*)::int n FROM public.documents WHERE id=$1", [
        doc.document.id,
      ])
    ).n,
    1,
  );
  assert.equal(
    (
      await review(
        h,
        f,
        first.body.id,
        "edited",
        "Forbidden amendment",
        saved.body.note.revision,
      )
    ).status,
    409,
  );
  const foreign = await request(
    auth(f.foreignDoctor),
    "GET",
    `/api/consultations/${first.body.id}/note`,
    null,
    (r) => h.note.GET(r, { params: Promise.resolve({ id: first.body.id }) }),
  );
  assert.equal(foreign.status, 404);
});

test("stale document workers cannot overwrite a recovered attempt; immutable originals survive retries", async (t) => {
  const f = await fixture(t);
  const h = await handlers();
  const patient = await newPatient(h, f);
  const v = await walkIn(h, f, patient.id, "qa-stale-worker");
  assert.equal(v.status, 201);
  const assisted = await pgClient(auth(f.assistant)).rpc(
    "submit_assisted_patient_intake",
    {
      p_appointment_id: v.body.appointmentId,
      p_consent_version: "preconsult-intake-consent/v1.0",
      p_reason_for_visit_raw: "Synthetic assisted intake",
      p_conditions: [],
      p_medications: [],
      p_allergies: [],
    },
  );
  assert.equal(assisted.error, null);
  const doc = await registerDocument(h, f, v.body.consultationId, patient.id);
  const old = await claim();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = h.process.processClaimedMedicalDocument(old, {
    provider: "mock",
    modelVersion: "mock",
    process: async () => {
      await gate;
      return {
        ...extraction,
        pages: [
          { pageNumber: 1, text: "Late stale mock output", confidence: 0.99 },
        ],
      };
    },
  });
  await scalar(
    "UPDATE public.document_processing_work SET processing_started_at=now()-interval '16 minutes' WHERE id=$1 RETURNING id",
    [old.work_id],
  );
  const current = await claim();
  assert.notEqual(current.extraction_id, old.extraction_id);
  assert.equal(
    await h.process.processClaimedMedicalDocument(current, {
      provider: "mock",
      modelVersion: "mock",
      process: async () => extraction,
    }),
    true,
  );
  release();
  assert.equal(await pending, false);
  assert.equal(
    (
      await scalar(
        "SELECT status FROM public.document_processing_work WHERE id=$1",
        [old.work_id],
      )
    ).status,
    "completed",
  );
  assert.deepEqual(
    originals.get(doc.registration.storagePath),
    Uint8Array.from(doc.bytes),
  );
});

test("returning-patient scheduled journey preserves approved memory, intake and originals across reschedule and repeated check-in", async (t) => {
  const f = await fixture(t);
  const h = await handlers();
  const patient = await newPatient(h, f);
  const first = await walkIn(h, f, patient.id, "qa-returning-first");
  assert.equal(first.status, 201);
  assert.equal(
    (
      await review(
        h,
        f,
        first.body.consultationId,
        "approved",
        "Synthetic approved previous visit",
        null,
      )
    ).status,
    201,
  );
  const bookingBody = {
    patientId: patient.id,
    doctorId: f.doctor.profileId,
    scheduledAt: "2051-01-10T03:30:00Z",
    durationMinutes: 15,
    idempotencyKey: "qa-returning-booking",
  };
  const booked = await request(
    auth(f.assistant),
    "POST",
    "/api/appointments",
    bookingBody,
    h.booking.POST,
  );
  assert.equal(booked.status, 201);
  const again = await request(
    auth(f.assistant),
    "POST",
    "/api/appointments",
    bookingBody,
    h.booking.POST,
  );
  assert.equal(again.body.id, booked.body.id);
  const assisted = await pgClient(auth(f.assistant)).rpc(
    "submit_assisted_patient_intake",
    {
      p_appointment_id: booked.body.id,
      p_consent_version: "preconsult-intake-consent/v1.0",
      p_reason_for_visit_raw: "Synthetic returning-patient update",
      p_conditions: [],
      p_medications: [],
      p_allergies: [],
    },
  );
  assert.equal(assisted.error, null);
  const doc = await registerDocument(
    h,
    f,
    booked.body.consultationId,
    patient.id,
  );
  const changed = await request(
    auth(f.assistant),
    "PATCH",
    `/api/appointments/${booked.body.id}`,
    {
      action: "reschedule",
      scheduledAt: "2051-01-11T03:30:00Z",
      expectedUpdatedAt: booked.body.updatedAt,
      idempotencyKey: "qa-returning-reschedule",
    },
    (r) =>
      h.appointmentEdit.PATCH(r, {
        params: Promise.resolve({ id: booked.body.id }),
      }),
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.body.consultationId, booked.body.consultationId);
  assert.equal(
    (
      await scalar("SELECT consultation_id FROM public.documents WHERE id=$1", [
        doc.document.id,
      ])
    ).consultation_id,
    booked.body.consultationId,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(
          auth(f.assistant),
          "PATCH",
          `/api/appointments/${booked.body.id}/queue`,
          { operation: "check_in" },
          (r) =>
            h.queue.PATCH(r, {
              params: Promise.resolve({ id: booked.body.id }),
            }),
        )
      ).status,
      200,
    );
  const before = await scope.run(auth(f.doctor), () =>
    h.memory.getFollowUpMemory(patient.id, f.clinic),
  );
  assert.equal(before.approvedCount, 1);
  assert.equal(before.summary, "Synthetic approved previous visit");
  assert.equal(
    (
      await request(
        auth(f.doctor),
        "PATCH",
        `/api/appointments/${booked.body.id}/queue`,
        { operation: "start_consultation" },
        (r) =>
          h.queue.PATCH(r, { params: Promise.resolve({ id: booked.body.id }) }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await review(
        h,
        f,
        booked.body.consultationId,
        "edited",
        "Synthetic returning draft",
        null,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await scope.run(auth(f.doctor), () =>
        h.memory.getFollowUpMemory(patient.id, f.clinic),
      )
    ).summary,
    "Synthetic approved previous visit",
  );
  assert.equal(
    (
      await review(
        h,
        f,
        booked.body.consultationId,
        "approved",
        "Synthetic returning approved note",
        1,
      )
    ).status,
    201,
  );
  const memory = await scope.run(auth(f.doctor), () =>
    h.memory.getFollowUpMemory(patient.id, f.clinic),
  );
  assert.equal(memory.approvedCount, 2);
  assert.equal(memory.summary, "Synthetic returning approved note");
  assert.equal(
    (
      await scalar(
        "SELECT reason_for_visit_raw FROM public.patient_intakes WHERE consultation_id=$1",
        [booked.body.consultationId],
      )
    ).reason_for_visit_raw,
    "Synthetic returning-patient update",
  );
  assert.deepEqual(
    originals.get(doc.registration.storagePath),
    Uint8Array.from(doc.bytes),
  );
});
