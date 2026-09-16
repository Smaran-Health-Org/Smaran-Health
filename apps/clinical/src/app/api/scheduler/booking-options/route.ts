import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient } from "@/lib/supabase/server";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session || !["doctor", "admin", "assistant"].includes(session.role)) return forbidden();
  const doctorId = request.nextUrl.searchParams.get("doctorId");
  if (!doctorId || !/^[0-9a-f-]{36}$/i.test(doctorId)) return badRequest("A valid doctor is required.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("appointment_types")
    .select("id, name, default_duration_minutes").eq("clinic_id", session.clinicId).eq("doctor_id", doctorId).eq("is_active", true).order("name");
  if (error) return internalError("Could not load appointment types.");
  return NextResponse.json({ data: data ?? [] });
}
