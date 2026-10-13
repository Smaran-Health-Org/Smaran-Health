import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "pg";
import { extractAndPersistDraft } from "../src/lib/consultations/extract-and-persist-draft";

// This harness must never connect to a remote or production database.
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString).hostname)) {
  throw new Error("Set SUPABASE_DB_URL to a disposable loopback database");
}
const connect = async () => { const c = new Client({ connectionString }); await c.connect(); return c; };
const code = (e: unknown) => (e as { code?: string })?.code;
const content = (summary: string) => ({ summary, chiefComplaint: "", medicationChanges: "", investigations: "",
  followUpPlan: "", patientInstructions: "", uncertainItems: "" });
type Fixture = { clinic: string; foreignClinic: string; doctor: string; colleague: string; assistant: string; admin: string; foreignDoctor: string; patient: string; visit: string };
async function fixture(t: { after: (fn: () => Promise<void>) => void }): Promise<Fixture> {
  const f = { clinic: randomUUID(), foreignClinic: randomUUID(), doctor: randomUUID(), colleague: randomUUID(),
    assistant: randomUUID(), admin: randomUUID(), foreignDoctor: randomUUID(), patient: randomUUID(), visit: randomUUID() };
  t.after(async () => {
    const c = await connect();
    try {
      await c.query("BEGIN; SET LOCAL session_replication_role = replica");
      const tables = await c.query<{ table_name: string }>("SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND c.column_name='clinic_id' AND t.table_type='BASE TABLE'");
      for (const { table_name } of tables.rows) await c.query(`DELETE FROM public."${table_name.replaceAll('"', '""')}" WHERE clinic_id = ANY($1::uuid[])`, [[f.clinic, f.foreignClinic]]);
      await c.query("DELETE FROM public.clinics WHERE id = ANY($1::uuid[])", [[f.clinic, f.foreignClinic]]);
      await c.query("COMMIT");
    } finally { await c.end(); }
  });
  const c = await connect();
  try {
    await c.query("INSERT INTO public.clinics(id,name) VALUES($1,'Synthetic clinic'),($2,'Synthetic foreign clinic')", [f.clinic, f.foreignClinic]);
    for (const [id, clinic, role] of [[f.doctor, f.clinic, 'doctor'], [f.colleague, f.clinic, 'doctor'], [f.assistant, f.clinic, 'assistant'], [f.admin, f.clinic, 'admin'], [f.foreignDoctor, f.foreignClinic, 'doctor']]) {
      await c.query("INSERT INTO public.profiles(id,clinic_id,email,full_name,role) VALUES($1,$2,$3,'Synthetic staff',$4)", [id, clinic, `synthetic-${id}@example.invalid`, role]);
    }
    await c.query("INSERT INTO public.patients(id,clinic_id,full_name) VALUES($1,$2,'Synthetic patient')", [f.patient, f.clinic]);
    await c.query("INSERT INTO public.consultations(id,clinic_id,patient_id,doctor_id) VALUES($1,$2,$3,$4)", [f.visit, f.clinic, f.patient, f.doctor]);
    await c.query("INSERT INTO public.transcripts(consultation_id,clinic_id,raw_text) VALUES($1,$2,'Synthetic original transcript')", [f.visit, f.clinic]);
  } finally { await c.end(); }
  return f;
}
async function begin(c: Client, actor: string | null, role = 'authenticated') {
  assert.ok(['authenticated', 'service_role'].includes(role));
  await c.query(`BEGIN; SET LOCAL ROLE ${role}`);
  await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [actor ?? '', role]);
}
async function asActor<T>(c: Client, actor: string | null, work: () => Promise<T>, role = 'authenticated') {
  await begin(c, actor, role);
  try { const r = await work(); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
}
async function review(c: Client, f: Fixture, status: string, summary: string, revision: number | null) {
  return (await c.query("SELECT public.review_clinical_note($1,$2,$3,$4,$5,$6) note", [f.visit, f.clinic, content(summary), status, summary, revision])).rows[0].note;
}
async function draft(c: Client, f: Fixture, summary: string, source = 'doctor') {
  return (await c.query("SELECT public.create_clinical_draft($1,$2,$3,$4,'{}'::jsonb) result", [f.visit, f.clinic, content(summary), source])).rows[0].result;
}
async function blocked(monitor: Client, waiting: Client, holder: Client) {
  const pid = (waiting as unknown as { processID: number }).processID;
  const holderPid = (holder as unknown as { processID: number }).processID;
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if ((await monitor.query("SELECT $2::int = ANY(pg_blocking_pids($1::int)) blocked", [pid, holderPid])).rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected an observed database lock barrier');
}

test('staff cannot change authority; own display-name editing and clinic isolation remain', async t => {
  const f = await fixture(t); const c = await connect();
  try {
    for (const actor of [f.assistant, f.admin, f.doctor]) {
      await asActor(c, actor, () => c.query("UPDATE public.profiles SET full_name='Updated display name' WHERE id=$1", [actor]));
      for (const mutation of ["role='doctor'", `clinic_id='${f.foreignClinic}'`, "email='changed@example.invalid'", `id='${randomUUID()}'`, 'created_at=now()']) {
        await assert.rejects(() => asActor(c, actor, () => c.query(`UPDATE public.profiles SET ${mutation} WHERE id=$1`, [actor])), e => code(e) === '42501');
      }
    }
    for (const target of [f.colleague, f.foreignDoctor]) assert.equal((await asActor(c, f.doctor, () => c.query("UPDATE public.profiles SET full_name='Unauthorized' WHERE id=$1", [target]))).rowCount, 0);
    await asActor(c, f.assistant, async () => {
      assert.equal((await c.query('SELECT public.get_clinic_id() id')).rows[0].id, f.clinic);
      assert.equal((await c.query('SELECT role FROM public.profiles WHERE id=$1', [f.assistant])).rows[0].role, 'assistant');
      assert.equal((await c.query('SELECT id FROM public.profiles WHERE id=$1', [f.foreignDoctor])).rowCount, 0);
    });
    await assert.rejects(() => asActor(c, f.doctor, () => c.query("INSERT INTO public.profiles(id,clinic_id,email,full_name) VALUES($1,$2,'injected@example.invalid','Injected')", [randomUUID(), f.clinic])), e => code(e) === '42501');
    await asActor(c, null, () => c.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [f.assistant]), 'service_role');
    assert.equal((await c.query('SELECT role FROM public.profiles WHERE id=$1', [f.assistant])).rows[0].role, 'admin');
  } finally { await c.end(); }
});

for (const status of ['edited', 'approved', 'rejected']) for (const failProvider of [false, true]) {
  test(`late ${failProvider ? 'fallback' : 'AI'} preserves a human ${status} note`, async t => {
    const f = await fixture(t); const c = await connect();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = extractAndPersistDraft('Synthetic original transcript', {
      extract: async () => { await gate; if (failProvider) throw new Error('Mock unavailable'); return { draft: content('Late AI'), provider: 'deepseek', model: 'mock', promptVersion: 'mock', fallbackUsed: false }; },
      persist: note => asActor(c, f.doctor, () => draft(c, f, note.summary)),
    });
    try {
      const human = await asActor(c, f.doctor, () => review(c, f, status, 'Human work', null));
      const before = (await c.query('SELECT status FROM public.consultations WHERE id=$1', [f.visit])).rows[0].status;
      release(); const r = await pending;
      assert.equal(r.persisted.created, false); assert.equal(r.persisted.note.id, human.id);
      assert.deepEqual(r.persisted.note.content, content('Human work')); assert.equal(r.persisted.note.status, status);
      assert.equal((await c.query('SELECT status FROM public.consultations WHERE id=$1', [f.visit])).rows[0].status, before);
      assert.equal((await c.query('SELECT count(*)::int n FROM public.clinical_notes WHERE consultation_id=$1', [f.visit])).rows[0].n, 1);
      assert.equal((await c.query('SELECT raw_text FROM public.transcripts WHERE consultation_id=$1', [f.visit])).rows[0].raw_text, 'Synthetic original transcript');
    } finally { release(); await pending.catch(() => null); await c.end(); }
  });
}

test('two generators serialize at an observed lock and create one intended note', async t => {
  const f = await fixture(t); const a = await connect(); const b = await connect(); const m = await connect();
  try {
    await begin(a, f.doctor); const first = await draft(a, f, 'First AI');
    const later = asActor(b, null, () => draft(b, f, 'Second AI', 'background'), 'service_role');
    await blocked(m, b, a); await a.query('COMMIT'); const second = await later;
    assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(second.note.id, first.note.id);
    assert.deepEqual(second.note.content, content('First AI'));
    assert.equal((await m.query('SELECT count(*)::int n FROM public.clinical_notes WHERE consultation_id=$1', [f.visit])).rows[0].n, 1);
    assert.equal((await m.query("SELECT count(*)::int n FROM public.audit_logs WHERE resource_id=$1 AND action='clinical_note.ai_generated'", [first.note.id])).rows[0].n, 1);
    await assert.rejects(() => m.query('INSERT INTO public.clinical_notes(consultation_id,clinic_id,doctor_id,content) VALUES($1,$2,$3,$4)', [f.visit, f.clinic, f.doctor, content('Duplicate')]), e => code(e) === '23505');
  } finally { await a.query('ROLLBACK'); await Promise.all([a.end(), b.end(), m.end()]); }
});

test('manual save holds the lock against an already-started generator', async t => {
  const f = await fixture(t); const a = await connect(); const b = await connect(); const m = await connect();
  try {
    await begin(a, f.doctor); const human = await review(a, f, 'edited', 'Locked human work', null);
    const later = asActor(b, f.doctor, () => draft(b, f, 'AI'));
    await blocked(m, b, a); await a.query('COMMIT'); const result = await later;
    assert.equal(result.created, false); assert.equal(result.note.id, human.id); assert.deepEqual(result.note.content, content('Locked human work'));
  } finally { await a.query('ROLLBACK'); await Promise.all([a.end(), b.end(), m.end()]); }
});

test('concurrent approval retry has one timeline/audit effect; amendments and unauthorized actors are blocked', async t => {
  const f = await fixture(t); const a = await connect(); const b = await connect(); const m = await connect();
  try {
    await begin(a, f.doctor); const first = await review(a, f, 'approved', 'Approved work', null);
    const later = asActor(b, f.doctor, () => review(b, f, 'approved', 'Approved work', null));
    await blocked(m, b, a);
    assert.equal((await m.query('SELECT count(*)::int n FROM public.clinical_notes WHERE consultation_id=$1', [f.visit])).rows[0].n, 0);
    await a.query('COMMIT'); assert.deepEqual(await later, first);
    const effects = () => m.query('SELECT (SELECT count(*)::int FROM public.audit_logs WHERE clinic_id=$1) audit,(SELECT count(*)::int FROM public.preconsult_brief_generation_work WHERE clinic_id=$1) work', [f.clinic]);
    const before = (await effects()).rows[0];
    assert.deepEqual(await asActor(b, f.doctor, () => review(b, f, 'approved', 'Approved work', null)), first);
    assert.deepEqual((await effects()).rows[0], before);
    assert.equal((await m.query("SELECT count(*)::int n FROM public.audit_logs WHERE resource_id=$1 AND action='clinical_note.updated'", [first.id])).rows[0].n, 1);
    assert.equal((await m.query('SELECT count(*)::int n FROM public.patient_timeline_events WHERE clinical_note_id=$1', [first.id])).rows[0].n, 1);
    for (const status of ['edited', 'rejected', 'approved']) await assert.rejects(() => asActor(b, f.doctor, () => review(b, f, status, 'Changed approved work', first.revision)), e => code(e) === '55000');
    await assert.rejects(() => asActor(b, f.doctor, () => b.query("UPDATE public.consultations SET status='draft_ready' WHERE id=$1", [f.visit])), e => code(e) === '55000');
    for (const actor of [f.assistant, f.admin, f.colleague, f.foreignDoctor]) await assert.rejects(() => asActor(b, actor, () => review(b, f, 'approved', 'Unauthorized', first.revision)), e => code(e) === '42501');
    await assert.rejects(() => asActor(b, f.doctor, () => b.query('UPDATE public.clinical_notes SET content=$1 WHERE id=$2', [content('Bypass'), first.id])), e => code(e) === '42501');
    await assert.rejects(() => asActor(b, null, () => b.query('UPDATE public.clinical_notes SET content=$1 WHERE id=$2', [content('Service bypass'), first.id]), 'service_role'), e => code(e) === '55000');
    await assert.rejects(() => asActor(b, null, () => review(b, f, 'approved', 'Service approval', first.revision), 'service_role'), e => code(e) === '42501');
    await assert.rejects(() => asActor(b, f.doctor, () => b.query("INSERT INTO public.patient_timeline_events(patient_id,clinic_id,event_type) VALUES($1,$2,'follow_up')", [f.patient, f.clinic])), e => code(e) === '42501');
  } finally { await a.query('ROLLBACK'); await Promise.all([a.end(), b.end(), m.end()]); }
});

for (const failure of ['timeline', 'consultation', 'audit']) {
  test(`a ${failure} failure rolls back all approval effects and the same request can be retried`, async t => {
    const f = await fixture(t); const admin = await connect(); const c = await connect(); const suffix = randomUUID().replaceAll('-', '');
    const trigger = `synthetic_failure_${suffix}`; const fn = `synthetic_failure_fn_${suffix}`;
    const table = failure === 'timeline' ? 'patient_timeline_events' : failure === 'consultation' ? 'consultations' : 'audit_logs';
    try {
      const original = await asActor(c, f.doctor, () => review(c, f, 'edited', 'Preserved original', null));
      const before = (await admin.query('SELECT count(*)::int n FROM public.audit_logs WHERE clinic_id=$1', [f.clinic])).rows[0].n;
      const condition = failure === 'audit' ? "AND NEW.action='clinical_note.updated'" : failure === 'consultation' ? "AND NEW.status='approved'" : '';
      await admin.query(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.clinic_id='${f.clinic}' ${condition} THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE ${failure === 'consultation' ? 'UPDATE' : 'INSERT'} ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
      await assert.rejects(() => asActor(c, f.doctor, () => review(c, f, 'approved', 'Requested approval', original.revision)), e => code(e) === 'P0001');
      const saved = (await admin.query('SELECT * FROM public.clinical_notes WHERE id=$1', [original.id])).rows[0];
      assert.deepEqual(saved.content, original.content); assert.equal(saved.status, 'edited'); assert.equal(saved.revision, original.revision); assert.equal(saved.approved_at, null);
      assert.equal((await admin.query('SELECT count(*)::int n FROM public.patient_timeline_events WHERE consultation_id=$1', [f.visit])).rows[0].n, 0);
      assert.equal((await admin.query('SELECT status FROM public.consultations WHERE id=$1', [f.visit])).rows[0].status, 'draft_ready');
      assert.equal((await admin.query('SELECT count(*)::int n FROM public.audit_logs WHERE clinic_id=$1', [f.clinic])).rows[0].n, before);
      await admin.query(`DROP TRIGGER ${trigger} ON public.${table}; DROP FUNCTION public.${fn}()`);
      assert.equal((await asActor(c, f.doctor, () => review(c, f, 'approved', 'Requested approval', original.revision))).status, 'approved');
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS ${trigger} ON public.${table}; DROP FUNCTION IF EXISTS public.${fn}()`);
      await Promise.all([admin.end(), c.end()]);
    }
  });
}

test('stale human saves cannot overwrite a newer edit; identical successful draft save replays', async t => {
  const f = await fixture(t); const c = await connect();
  try {
    const original = await asActor(c, f.doctor, () => review(c, f, 'edited', 'Original', null));
    assert.deepEqual(await asActor(c, f.doctor, () => review(c, f, 'edited', 'Original', null)), original);
    const newer = await asActor(c, f.doctor, () => review(c, f, 'edited', 'New human edit', original.revision));
    await assert.rejects(() => asActor(c, f.doctor, () => review(c, f, 'approved', 'Stale approval', original.revision)), e => code(e) === '40001');
    assert.deepEqual((await c.query('SELECT content FROM public.clinical_notes WHERE id=$1', [newer.id])).rows[0].content, content('New human edit'));
  } finally { await c.end(); }
});

test('duplicate-note migration preflight fails without choosing or deleting historical notes', async t => {
  const f = await fixture(t); const c = await connect();
  try {
    await c.query('BEGIN; ALTER TABLE public.clinical_notes DROP CONSTRAINT clinical_notes_consultation_unique');
    for (const text of ['Historical human A', 'Historical human B']) await c.query("INSERT INTO public.clinical_notes(consultation_id,clinic_id,doctor_id,status,content) VALUES($1,$2,$3,'edited',$4)", [f.visit, f.clinic, f.doctor, content(text)]);
    await c.query('SAVEPOINT preflight');
    const migration = readFileSync(new URL('../supabase/migrations/0105_insert_only_clinical_drafts.sql', import.meta.url), 'utf8');
    await assert.rejects(() => c.query(migration), e => code(e) === '23505');
    await c.query('ROLLBACK TO SAVEPOINT preflight');
    assert.equal((await c.query('SELECT count(*)::int n FROM public.clinical_notes WHERE consultation_id=$1', [f.visit])).rows[0].n, 2);
  } finally { await c.query('ROLLBACK'); await c.end(); }
});


test('consultation approval cannot bypass note review, and a malformed foreign note is not returned', async t => {
  const f = await fixture(t); const c = await connect();
  try {
    await assert.rejects(() => asActor(c, f.doctor, () => c.query("UPDATE public.consultations SET status='approved' WHERE id=$1", [f.visit])), e => code(e) === '55000');
    for (const actor of [f.assistant, f.admin, f.colleague, f.foreignDoctor]) {
      await assert.rejects(() => asActor(c, actor, () => draft(c, f, 'Unauthorized')), e => code(e) === '42501');
    }
    const foreignScope = { ...f, clinic: f.foreignClinic };
    await assert.rejects(() => asActor(c, f.foreignDoctor, () => draft(c, foreignScope, 'Foreign lookup')), e => code(e) === 'P0002');
    await assert.rejects(() => asActor(c, f.foreignDoctor, () => review(c, foreignScope, 'approved', 'Foreign lookup', null)), e => code(e) === 'P0002');
    await assert.rejects(() => asActor(c, null, () => draft(c, foreignScope, 'Foreign lookup', 'background'), 'service_role'), e => code(e) === 'P0002');
    await asActor(c, f.assistant, async () => assert.equal((await c.query('SELECT id FROM public.clinical_notes WHERE consultation_id=$1', [f.visit])).rowCount, 0));
    await c.query("INSERT INTO public.clinical_notes(consultation_id,clinic_id,doctor_id,content) VALUES($1,$2,$3,$4)", [f.visit, f.foreignClinic, f.foreignDoctor, content('Synthetic foreign content')]);
    await assert.rejects(() => asActor(c, f.doctor, () => draft(c, f, 'AI')), e => code(e) === '42501');
    await assert.rejects(() => asActor(c, null, () => draft(c, f, 'AI', 'background'), 'service_role'), e => code(e) === '42501');
  } finally { await c.end(); }
});
