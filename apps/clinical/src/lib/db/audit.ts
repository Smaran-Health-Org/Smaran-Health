import { createClient as createServerClient } from "@/lib/supabase/server";

type AuditLogClient = {
  from(table: "audit_logs"): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  };
};

const AUDIT_LOG_WRITE_FAILURE_EVENT = "audit_log_write_failed";

function reportAuditWriteFailure() {
  // Database/provider errors can contain sensitive request or record details.
  console.error(AUDIT_LOG_WRITE_FAILURE_EVENT);
}

export async function createAuditLogWithClient(
  supabase: AuditLogClient,
  clinicId: string,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      clinic_id: clinicId,
      actor_id: actorId,
      action,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
      metadata: metadata ?? null,
    });

    if (error) reportAuditWriteFailure();
  } catch {
    reportAuditWriteFailure();
  }
}

export async function createAuditLog(
  clinicId: string,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    const supabase = await createServerClient();
    await createAuditLogWithClient(
      supabase,
      clinicId,
      actorId,
      action,
      resourceType,
      resourceId,
      metadata
    );
  } catch {
    // Never throw from this best-effort audit helper — audit failure must not
    // block the operation. Required transactional audits remain in their RPCs.
    reportAuditWriteFailure();
  }
}
