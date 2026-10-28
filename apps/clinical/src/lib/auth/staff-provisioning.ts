import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuditLogWithClient } from "@/lib/db/audit";
import { shouldGrantTrial } from "@/lib/auth/trial-allowlist";
import type { SessionContext } from "@/types";

/**
 * Staff provisioning.
 *
 * Accounts are admin-provisioned (signups are disabled), so this is the only
 * path that creates one. Two rules shape it:
 *
 *   • A doctor creates their own reception. Reception belongs to exactly one
 *     doctor, and two doctors' reception must not see each other.
 *   • A new doctor is granted a trial only if the allowlist says so. The
 *     allowlist is an env var so a trial can be issued on the fly.
 *
 * Uses the service role because `profiles` is deliberately not writable by
 * `authenticated` (0104) and `auth.admin.createUser` needs it.
 */

export type StaffRole = "doctor" | "assistant" | "admin";

export class StaffProvisioningError extends Error {
  constructor(
    public readonly kind:
      | "forbidden"
      | "invalid"
      | "duplicate"
      | "unavailable"
      | "not_found"
  ) {
    super("Staff provisioning failed");
  }
}

const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new StaffProvisioningError("invalid");
}

/**
 * Creates a reception account owned by the acting doctor.
 *
 * `admin` and `assistant` are the same capability set, so the caller picks the
 * label; ownership is what actually scopes the account.
 */
export async function createReceptionAccount(input: {
  session: SessionContext;
  email: string;
  fullName: string;
  password: string;
  role?: "assistant" | "admin";
}): Promise<{ profileId: string; email: string }> {
  if (input.session.role !== "doctor") throw new StaffProvisioningError("forbidden");

  const email = normalizeEmail(input.email);
  const fullName = input.fullName.trim();
  if (!email.includes("@") || !fullName) throw new StaffProvisioningError("invalid");
  assertPassword(input.password);

  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error || !created.user) {
    // Supabase reports an existing address as a generic error; the only useful
    // distinction for the caller is "already taken".
    if (/already|exists|registered/i.test(error?.message ?? "")) {
      throw new StaffProvisioningError("duplicate");
    }
    throw new StaffProvisioningError("unavailable");
  }

  // The auth trigger already inserted a profile as a trial doctor in the first
  // clinic. Correct it to the real shape: this clinic, this role, this owner.
  const service = createServiceRoleClient();
  const { error: profileError } = await service
    .from("profiles")
    .update({
      clinic_id: input.session.clinicId,
      role: input.role ?? "assistant",
      owner_doctor_id: input.session.profileId,
      access_state: "active",
      full_name: fullName,
    })
    .eq("id", created.user.id);

  if (profileError) {
    // Leaving a half-provisioned auth user behind would block the address on
    // retry, so undo it rather than reporting success.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    throw new StaffProvisioningError("unavailable");
  }

  await service
    .from("clinic_memberships")
    .upsert({ clinic_id: input.session.clinicId, profile_id: created.user.id });

  await createAuditLogWithClient(
    service,
    input.session.clinicId,
    input.session.profileId,
    "staff.created",
    "profile",
    created.user.id,
    { role: input.role ?? "assistant" }
  );

  return { profileId: created.user.id, email };
}

/**
 * Grants or revokes access.
 *
 * Revocation is `suspended`, not deletion: the account keeps its history and can
 * be restored. There is no expiry, so this is the only thing that ends a trial.
 */
export async function setAccessState(input: {
  session: SessionContext;
  profileId: string;
  accessState: "active" | "trial" | "suspended";
}): Promise<void> {
  if (input.session.role !== "doctor") throw new StaffProvisioningError("forbidden");

  const service = createServiceRoleClient();
  const { data: target, error } = await service
    .from("profiles")
    .select("id, clinic_id, role, owner_doctor_id, access_state")
    .eq("id", input.profileId)
    .eq("clinic_id", input.session.clinicId)
    .maybeSingle();

  if (error) throw new StaffProvisioningError("unavailable");
  if (!target) throw new StaffProvisioningError("not_found");

  // A doctor may only manage staff they own, and never another doctor's access.
  const ownsTarget =
    target.id === input.session.profileId ||
    target.owner_doctor_id === input.session.profileId;
  if (!ownsTarget) throw new StaffProvisioningError("forbidden");

  if (target.access_state === input.accessState) return;

  const { error: updateError } = await service
    .from("profiles")
    .update({ access_state: input.accessState })
    .eq("id", input.profileId)
    .eq("clinic_id", input.session.clinicId);

  if (updateError) throw new StaffProvisioningError("unavailable");

  await createAuditLogWithClient(
    service,
    input.session.clinicId,
    input.session.profileId,
    `staff.access_${input.accessState}`,
    "profile",
    input.profileId,
    { from: target.access_state, to: input.accessState }
  );
}

/**
 * Applies the allowlist to a doctor who has just been provisioned.
 *
 * Called after account creation rather than inside the auth trigger, because the
 * trigger cannot read the app's environment.
 */
export async function applyTrialPolicy(profileId: string, email: string): Promise<boolean> {
  const trial = shouldGrantTrial(email, {
    enabled: process.env.TRIAL_ACCESS_ENABLED,
    allowlist: process.env.TRIAL_DOCTOR_EMAILS,
  });
  if (!trial) return false;

  const service = createServiceRoleClient();
  const { error } = await service
    .from("profiles")
    .update({ access_state: "trial" })
    .eq("id", profileId);
  return !error;
}
