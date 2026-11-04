import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { findTrialEntry, isTrialEnabled } from "./trial-allowlist";

/**
 * Self-service trial provisioning.
 *
 * The operator adds `doctor@clinic.com:Passw0rd!` to `TRIAL_DOCTOR_EMAILS` and
 * the doctor can sign in immediately — no script, no database access, no deploy
 * of app logic. The first sign-in attempt creates the account.
 *
 * Why on login rather than on a schedule: there is no event to hang it off. The
 * list is static config, so the only moment the app learns a doctor exists is
 * when they try to sign in.
 *
 * Security posture:
 *   • the password is in an env var, so it is only as secret as the Vercel
 *     project — acceptable for trial accounts, not for real patient data;
 *   • provisioning only happens for an address that is on the list, so an
 *     arbitrary visitor cannot create accounts;
 *   • the account is created `trial`, which withholds patient merge and
 *     Scheduler settings.
 */

export type TrialProvisionResult =
  | { provisioned: true; email: string }
  | { provisioned: false; reason: "disabled" | "not_listed" | "no_password" | "failed" };

/**
 * Creates the account for an allowlisted address if it does not exist yet.
 *
 * Idempotent: an existing account is left completely alone, so a doctor who
 * changed their password keeps it.
 */
export async function provisionTrialAccount(email: string): Promise<TrialProvisionResult> {
  if (!isTrialEnabled(process.env.TRIAL_ACCESS_ENABLED)) {
    return { provisioned: false, reason: "disabled" };
  }

  const entry = findTrialEntry(email, process.env.TRIAL_DOCTOR_EMAILS);
  if (!entry) return { provisioned: false, reason: "not_listed" };
  if (!entry.password) return { provisioned: false, reason: "no_password" };

  const normalized = email.trim().toLowerCase();
  const service = createServiceRoleClient();

  // Already provisioned? Leave it alone — the doctor may have changed the
  // password, and re-applying the env value would silently undo that.
  const { data: existing } = await service
    .from("profiles")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();
  if (existing) return { provisioned: false, reason: "not_listed" };

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: normalized,
    password: entry.password,
    email_confirm: true,
    user_metadata: { full_name: normalized.split("@")[0] },
  });

  // A concurrent first attempt can lose the race; that is success, not failure.
  if (error || !created.user) {
    const { data: raced } = await service
      .from("profiles")
      .select("id")
      .eq("email", normalized)
      .maybeSingle();
    return raced ? { provisioned: true, email: normalized } : { provisioned: false, reason: "failed" };
  }

  // `handle_new_user` (0110) already created the profile, its personal clinic
  // and the membership. Only the display name needs improving.
  await service
    .from("profiles")
    .update({ full_name: normalized.split("@")[0] })
    .eq("id", created.user.id);

  return { provisioned: true, email: normalized };
}
