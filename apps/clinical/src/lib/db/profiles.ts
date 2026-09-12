import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { cached } from "@/lib/cache/memory-cache";

type ProfileRow = {
  id: string;
  clinic_id: string;
  email: string;
  full_name: string;
  role: "doctor" | "assistant" | "admin";
};

// Profile rows change rarely, so cache them by the owner's user id (never
// shared across users) to skip a round-trip on every navigation. Short TTL so
// role/name edits propagate quickly.
export const getProfileByUserId = cache((userId: string): Promise<ProfileRow | null> =>
  cached(`profile:${userId}`, 60_000, async () => {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, clinic_id, email, full_name, role")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`Failed to load profile: ${error.message}`);
    }
    return (data as ProfileRow) ?? null;
  })
);
