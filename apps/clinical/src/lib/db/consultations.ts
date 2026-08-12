import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Consultation } from "@/types";

export async function getConsultations(
  patientId: string,
  clinicId: string
): Promise<Consultation[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select("*")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch consultations: ${error.message}`);
  return data as Consultation[];
}

export async function getConsultation(
  id: string,
  clinicId: string
): Promise<Consultation | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select("*")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error && error.code !== "PGRST116") throw new Error(`Failed to fetch consultation: ${error.message}`);
  return data as Consultation | null;
}

export async function createConsultation(
  input: { patientId: string },
  clinicId: string,
  doctorId: string
): Promise<Consultation> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .insert({
      patient_id: input.patientId,
      clinic_id: clinicId,
      doctor_id: doctorId,
      status: "draft",
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create consultation: ${error.message}`);
  return data as Consultation;
}

export async function updateConsultation(
  id: string,
  input: {
    status?: string;
    consentAcquired?: boolean;
    consentVersion?: string;
    endedAt?: string;
  },
  clinicId: string
): Promise<Consultation> {
  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};
  if (input.status !== undefined) updateData.status = input.status;
  if (input.consentAcquired !== undefined) updateData.consent_acquired = input.consentAcquired;
  if (input.consentVersion !== undefined) updateData.consent_version = input.consentVersion;
  if (input.endedAt !== undefined) updateData.ended_at = input.endedAt;

  const { data, error } = await supabase
    .from("consultations")
    .update(updateData)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update consultation: ${error.message}`);
  return data as Consultation;
}
