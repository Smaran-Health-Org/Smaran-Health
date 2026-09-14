import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });
import { createAdminClient } from "../lib/supabase/admin";

// Seed script — uses service_role key, bypasses RLS intentionally.
// Run: npx tsx src/db/seed.ts

export function assertSafeLocalSeedTarget(url = process.env.NEXT_PUBLIC_SUPABASE_URL, allowLocalSeed = process.env.SMARAN_LOCAL_SEED) {
  if (allowLocalSeed !== "1") {
    throw new Error("Refusing to seed: set SMARAN_LOCAL_SEED=1 for an explicit local synthetic-data seed.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error("Refusing to seed: NEXT_PUBLIC_SUPABASE_URL must be a local Supabase URL.");
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error("Refusing to seed: synthetic accounts may only be created against localhost.");
  }
}

async function seed() {
  assertSafeLocalSeedTarget();
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

  // ── 2. Create clinic staff ────────────────────────────────────────────────

  const staff: Array<{
    email: string;
    password: string;
    fullName: string;
    role: "doctor" | "admin";
  }> = [
    { email: "doctor1@pilot.test", password: "pilot123!", fullName: "Dr. Meera Patil", role: "doctor" },
    { email: "doctor2@pilot.test", password: "pilot123!", fullName: "Dr. Rajesh Kumar", role: "doctor" },
    { email: "doctor@test.com", password: "test@123", fullName: "Test Doctor", role: "doctor" },
    { email: "admin@test.com", password: "test@123", fullName: "Test Admin", role: "admin" },
  ];

  for (const member of staff) {
    // Create auth user
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: member.email,
      password: member.password,
      email_confirm: true,
      user_metadata: { full_name: member.fullName },
    });

    if (authErr) {
      console.error(`Failed to create auth user ${member.email}:`, authErr.message);
      continue;
    }

    // The database trigger (on_auth_user_created) creates the profile + membership automatically.
    // But we need to ensure the profile points to our specific clinic.
    // Update profile to use our clinic
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ clinic_id: clinic.id, role: member.role })
      .eq("id", authUser.user.id);

    if (profileErr) {
      console.error(`Failed to update profile for ${member.email}:`, profileErr.message);
    }

    // Update membership too
    const { error: memErr } = await supabase
      .from("clinic_memberships")
      .upsert({ clinic_id: clinic.id, profile_id: authUser.user.id });

    if (memErr) {
      console.error(`Failed to update membership for ${member.email}:`, memErr.message);
    }

    console.log(`✓ ${member.role === "admin" ? "Admin" : "Doctor"}: ${member.fullName} (${member.email})`);
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

    // ── 5. Sample draft note on the latest consultation (demo of review flow) ──

    const { data: draftCons } = await supabase
      .from("consultations")
      .select("id")
      .eq("patient_id", patient1.id)
      .eq("status", "draft")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (draftCons) {
      const { error: noteErr } = await supabase.from("clinical_notes").insert({
        consultation_id: draftCons.id,
        clinic_id: clinic.id,
        doctor_id: profile1.id,
        status: "ai_draft",
        content: {
          summary:
            "Type 2 diabetes follow-up. HbA1c improved from 8.1% to 7.4% on metformin 500mg twice daily. Advised walking 30 min/day and reduced sugar intake. Next review in 3 months with repeat HbA1c.",
          medicationChanges: "No change — metformin 500mg BD continued.",
          investigations: "HbA1c reviewed (7.4%).",
          uncertainItems: "",
        },
      });

      if (noteErr) {
        console.error(`Failed to create sample note:`, noteErr.message);
      } else {
        const { error: readyErr } = await supabase
          .from("consultations")
          .update({ status: "draft_ready" })
          .eq("id", draftCons.id);

        if (readyErr) {
          console.error(`Failed to mark consultation ready for review:`, readyErr.message);
        } else {
          console.log(`✓ Sample draft note created (consultation ${draftCons.id}) — dashboard will show it under "Needs your review"`);
        }
      }
    }
  }

  console.log("\n✅ Seed complete!");
  console.log("\nSynthetic local seed complete. Run: npm run dev  →  http://localhost:3000\n");
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().catch((err) => {
    console.error("Seed failed:", err instanceof Error ? err.message : "unknown error");
    process.exit(1);
  });
}
