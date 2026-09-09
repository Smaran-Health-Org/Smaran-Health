import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { cached } from "@/lib/cache/memory-cache";

export const getClinicName = cache((clinicId: string): Promise<string> =>
  cached(`clinic-name:${clinicId}`, 300_000, async () => {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from("clinics")
      .select("name")
      .eq("id", clinicId)
      .single();

    return data?.name ?? "Clinic";
  })
);

export type ClinicDoctor = { id: string; fullName: string };

export async function getClinicDoctors(clinicId: string): Promise<ClinicDoctor[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, fullName:full_name")
    .eq("clinic_id", clinicId)
    .eq("role", "doctor")
    .order("full_name", { ascending: true });
  if (error) throw new Error("Failed to load clinic doctors");
  return (data ?? []) as ClinicDoctor[];
}
