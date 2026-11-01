/* Reset (or inspect) a demo doctor's tenant.

   A trial account owns a private clinic, so its data can be cleared without
   touching anyone else's practice. That is the operational side of the demo
   boundary: a reviewer can be handed a fresh workspace between sessions, and a
   demo tenant cannot quietly accumulate synthetic patient records forever.

   Deletes, in dependency order, everything tenant-bearing: appointments,
   consultations, documents, intakes and patients for the tenant. Account rows
   (the auth user and profile) are preserved, so the credentials keep working.

   Usage:
     node scripts/reset-demo-tenant.cjs <project-ref> <doctor-email> [--confirm]
     node scripts/reset-demo-tenant.cjs <project-ref> --list
*/
const REF = process.argv[2] || process.env.SUPABASE_PROJECT_REF || "traorcuxhkmpvxykfjjg";
const ARG = process.argv[3];
const CONFIRM = process.argv.includes("--confirm");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN env var is required.");
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : [];
}

const esc = (value) => String(value).replace(/'/g, "''");

async function listTenants() {
  return sql(`
    select p.email,
           p.access_state,
           c.id as clinic_id,
           c.name as clinic,
           (select count(*) from public.patients pt where pt.clinic_id = c.id)::int as patients,
           (select count(*) from public.appointments a where a.clinic_id = c.id)::int as appointments,
           (select count(*) from public.documents d where d.clinic_id = c.id)::int as documents
    from public.profiles p
    join public.clinics c on c.id = p.clinic_id
    order by p.access_state, p.email
  `);
}

async function resetTenant(email) {
  const [target] = await sql(`
    select p.id as profile_id, p.clinic_id, p.access_state, c.name as clinic,
           (select count(*) from public.profiles peer where peer.clinic_id = p.clinic_id)::int as peers
    from public.profiles p
    join public.clinics c on c.id = p.clinic_id
    where p.email = '${esc(email)}'
    limit 1
  `);

  if (!target) throw new Error(`No profile found for ${email}`);

  // Refuse a shared tenant outright. Deleting a clinic's records when another
  // doctor still lives there would destroy someone else's data, and "it was a
  // demo" is not a recovery plan.
  if (target.peers > 1) {
    throw new Error(
      `${email} shares clinic "${target.clinic}" with ${target.peers - 1} other account(s). ` +
        `This tool only resets a private tenant.`
    );
  }

  const counts = await sql(`
    select (select count(*) from public.patients where clinic_id = '${target.clinic_id}')::int as patients,
           (select count(*) from public.appointments where clinic_id = '${target.clinic_id}')::int as appointments,
           (select count(*) from public.consultations where clinic_id = '${target.clinic_id}')::int as consultations,
           (select count(*) from public.documents where clinic_id = '${target.clinic_id}')::int as documents
  `);

  console.log(`Tenant: ${target.clinic} (${target.clinic_id})`);
  console.log(`Account: ${email} [${target.access_state}]`);
  console.log(`Current rows: ${JSON.stringify(counts[0])}`);

  if (!CONFIRM) {
    console.log("\nDry run. Re-run with --confirm to delete these rows.");
    return;
  }

  const clinic = `'${target.clinic_id}'`;
  await sql(`
    begin;

    delete from public.appointment_events
      where appointment_id in (select id from public.appointments where clinic_id = ${clinic});
    delete from public.appointment_lifecycle_receipts
      where appointment_id in (select id from public.appointments where clinic_id = ${clinic});
    delete from public.appointment_scheduling_issue_history
      where issue_id in (
        select i.id from public.appointment_scheduling_issues i
        join public.appointments a on a.id = i.appointment_id
        where a.clinic_id = ${clinic}
      );
    delete from public.appointment_scheduling_issues
      where appointment_id in (select id from public.appointments where clinic_id = ${clinic});
    delete from public.appointments where clinic_id = ${clinic};

    delete from public.document_metadata_change_events
      where document_id in (select id from public.documents where clinic_id = ${clinic});
    delete from public.document_extractions
      where document_id in (select id from public.documents where clinic_id = ${clinic});
    delete from public.documents where clinic_id = ${clinic};

    delete from public.patient_intake_statements
      where intake_id in (select id from public.patient_intakes where clinic_id = ${clinic});
    delete from public.patient_intakes where clinic_id = ${clinic};

    delete from public.patient_timeline_events where clinic_id = ${clinic};
    delete from public.consultations where clinic_id = ${clinic};
    delete from public.patients where clinic_id = ${clinic};

    commit;
  `);

  console.log("Tenant data cleared. Account and credentials are untouched.");
  console.log(JSON.stringify(await listTenants(), null, 2));
}

(async () => {
  if (!ARG || ARG === "--list") {
    console.table(await listTenants());
    return;
  }
  await resetTenant(ARG);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
