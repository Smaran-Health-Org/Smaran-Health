import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { attachDebugEventLogSink, DEBUG_EVENT_RETENTION_DAYS } from "@/lib/debug-log-db";

export const runtime = "nodejs";

/**
 * Read/export endpoint for the verbose debug log.
 *
 * EXISTS FOR THE LIVE-TEST PHASE ONLY. Production evidence otherwise lives in
 * one durable table and a Vercel function log that rolls over; this makes the
 * timeline of a real consultation retrievable in one request while the doctor is
 * still sitting in front of you.
 *
 * Guarded by CRON_SECRET rather than a user session, deliberately — the log is a
 * cross-patient diagnostic record, so it must not be reachable from any clinic
 * session. It is also not linked from the UI.
 *
 * Example:
 *   GET /api/internal/debug-events?consultationId=<uuid>&limit=500
 *   GET /api/internal/debug-events?level=warn&limit=200
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  attachDebugEventLogSink();

  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 200) || 200, 1), 2000);
  const consultationId = params.get("consultationId");
  const scope = params.get("scope");
  const level = params.get("level");
  const since = params.get("since");

  const service = createServiceRoleClient();
  let query = service
    .from("debug_events")
    .select("occurred_at, level, scope, event, consultation_id, clinic_id, detail")
    // Oldest-first for a single consultation, because the useful question there
    // is "what happened, in order?".
    .order("occurred_at", { ascending: Boolean(consultationId) })
    .limit(limit);

  if (consultationId) query = query.eq("consultation_id", consultationId);
  if (scope) query = query.eq("scope", scope);
  if (level) query = query.eq("level", level);
  if (since) query = query.gte("occurred_at", since);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "debug_events_unavailable", message: error.message, hint: "Has migration 0102 been applied?" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      count: data?.length ?? 0,
      retentionDays: DEBUG_EVENT_RETENTION_DAYS,
      events: data ?? [],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
