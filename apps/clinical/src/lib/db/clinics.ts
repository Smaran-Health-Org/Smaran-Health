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
