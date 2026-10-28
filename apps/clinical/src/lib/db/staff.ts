import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/types";

/**
 * Staff directory for the acting doctor.
 *
 * Scoped to accounts the doctor owns, plus the doctor's own row. Another
 * doctor's reception is deliberately absent — that is the product rule, and it
 * is enforced here as well as in RLS so the list cannot drift from the data.
 */

export type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  role: "doctor" | "assistant" | "admin";
  accessState: "active" | "trial" | "suspended";
  isSelf: boolean;
};

export async function listOwnedStaff(session: SessionContext): Promise<StaffMember[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, access_state")
    .eq("clinic_id", session.clinicId)
    .or(`id.eq.${session.profileId},owner_doctor_id.eq.${session.profileId}`)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Failed to load staff");

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    accessState: row.access_state,
    isSelf: row.id === session.profileId,
  }));
}
