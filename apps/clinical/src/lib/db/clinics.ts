import { createClient as createServerClient } from "@/lib/supabase/server";

export async function getClinicName(clinicId: string): Promise<string> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .single();

  return data?.name ?? "Clinic";
}
