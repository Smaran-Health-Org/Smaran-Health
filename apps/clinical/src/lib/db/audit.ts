import { createClient as createServerClient } from "@/lib/supabase/server";

export async function createAuditLog(
  clinicId: string,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
) {
  const supabase = await createServerClient();
  const { error } = await supabase.from("audit_logs").insert({
    clinic_id: clinicId,
    actor_id: actorId,
    action,
    resource_type: resourceType,
    resource_id: resourceId ?? null,
    metadata: metadata ?? null,
  });

  if (error) {
    console.error("Audit log write failed:", error.message);
    // Never throw from audit — audit failure must not block the operation
  }
}
