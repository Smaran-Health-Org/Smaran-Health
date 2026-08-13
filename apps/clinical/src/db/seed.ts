import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });
import { createAdminClient } from "../lib/supabase/admin";

// Seed script — uses service_role key, bypasses RLS intentionally.
// Run: npx tsx src/db/seed.ts

async function seed() {
  const supabase = createAdminClient();

  console.log("🌱 Seeding database…\n");

  // ── 1. Create clinic ──────────────────────────────────────────────────────

  const { data: clinic, error: clinicErr } = await supabase
    .from("clinics")
    .insert({ name: "Meera's Clinic" })
    .select("*")
    .single();

  if (clinicErr) {
    console.error("Failed to create clinic:", clinicErr.message);
    process.exit(1);
  }
  console.log(`✓ Clinic: ${clinic.name} (${clinic.id})`);

  // ── 2. Create doctors ─────────────────────────────────────────────────────

  const doctors = [
    { email: "doctor1@pilot.test", password: "pilot123!", fullName: "Dr. Meera Patil" },
    { email: "doctor2@pilot.test", password: "pilot123!", fullName: "Dr. Rajesh Kumar" },
  ];

  for (const doc of doctors) {
    // Create auth user
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: doc.email,
      password: doc.password,
      email_confirm: true,
      user_metadata: { full_name: doc.fullName },
    });

    if (authErr) {
      console.error(`Failed to create auth user ${doc.email}:`, authErr.message);
      continue;
    }

    // The database trigger (on_auth_user_created) creates the profile + membership automatically.
    // But we need to ensure the profile points to our specific clinic.
    // Update profile to use our clinic
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ clinic_id: clinic.id })
      .eq("id", authUser.user.id);

    if (profileErr) {
      console.error(`Failed to update profile for ${doc.email}:`, profileErr.message);
    }

    // Update membership too
    const { error: memErr } = await supabase
      .from("clinic_memberships")
      .upsert({ clinic_id: clinic.id, profile_id: authUser.user.id });

    if (memErr) {
      console.error(`Failed to update membership for ${doc.email}:`, memErr.message);
    }

    console.log(`✓ Doctor: ${doc.fullName} (${doc.email} / ${doc.password})`);
  }

  // ── 3. Create patients ────────────────────────────────────────────────────

  const patientsData = [
    { full_name: "Ananya Sharma", age: 43, gender: "Female", phone: "+91 98765 43210" },
    { full_name: "Vikram Desai", age: 58, gender: "Male", phone: "+91 87654 32109" },
    { full_name: "Priya Iyer", age: 35, gender: "Female", phone: "+91 76543 21098" },
    { full_name: "Suresh Nair", age: 62, gender: "Male", phone: "+91 65432 10987" },
    { full_name: "Fatima Sheikh", age: 29, gender: "Female", phone: "+91 54321 09876" },
  ];

  for (const p of patientsData) {
    const { data: patient, error: patientErr } = await supabase
      .from("patients")
      .insert({ ...p, clinic_id: clinic.id })
      .select("*")
      .single();

    if (patientErr) {
      console.error(`Failed to create patient ${p.full_name}:`, patientErr.message);
      continue;
    }
    console.log(`✓ Patient: ${patient.full_name} (${patient.id})`);
  }

  // ── 4. Create sample consultations ────────────────────────────────────────

  const { data: profile1 } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", "doctor1@pilot.test")
    .single();

  const { data: patient1 } = await supabase
    .from("patients")
    .select("id")
    .eq("full_name", "Ananya Sharma")
    .eq("clinic_id", clinic.id)
    .single();

  if (profile1 && patient1) {
    const consultations = [
      { status: "approved", startedAt: "2026-07-15T10:00:00+05:30" },
      { status: "approved", startedAt: "2026-08-01T11:30:00+05:30" },
      { status: "draft", startedAt: "2026-08-12T09:00:00+05:30" },
    ];

    for (const c of consultations) {
      const { data: cons, error: consErr } = await supabase
        .from("consultations")
        .insert({
          patient_id: patient1.id,
          clinic_id: clinic.id,
          doctor_id: profile1.id,
          status: c.status,
          started_at: c.startedAt,
        })
        .select("*")
        .single();

      if (consErr) {
        console.error(`Failed to create consultation:`, consErr.message);
        continue;
      }
      console.log(`✓ Consultation: ${cons.id} (${cons.status})`);
    }
  }

  console.log("\n✅ Seed complete!");
  console.log("\n📋 Login credentials:");
  console.log("   doctor1@pilot.test / pilot123!");
  console.log("   doctor2@pilot.test / pilot123!");
  console.log("\n   Run: npm run dev  →  http://localhost:3000\n");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
