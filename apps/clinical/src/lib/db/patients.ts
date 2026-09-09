import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Patient } from "@/types";

// Cheap exact count used by the shell's patient-count badge. `head: true` skips
// the row payload, unlike `getPatients({ pageSize: 1 })` which wasted a fetch.
export const countPatients = cache(
  async (clinicId: string): Promise<number> => {
    const supabase = await createServerClient();
    const { count, error } = await supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);

    if (error) throw new Error(`Failed to count patients: ${error.message}`);
    return count ?? 0;
  }
);

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const PATIENT_COLUMNS =
  "id, clinicId:clinic_id, fullName:full_name, age, gender, phone, address, medicalRecordNumber:medical_record_number, createdAt:created_at, updatedAt:updated_at";

export async function getPatients(
  clinicId: string,
  opts?: { search?: string; page?: number; pageSize?: number }
): Promise<{ data: Patient[]; total: number }> {
  const supabase = await createServerClient();
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("patients")
    .select(PATIENT_COLUMNS, { count: "exact" })
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts?.search) {
    query = query.or(`full_name.ilike.%${opts.search}%,phone.ilike.%${opts.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to fetch patients: ${error.message}`);
  return { data: (data as Patient[]) ?? [], total: count ?? 0 };
}

export async function getPatient(
  id: string,
  clinicId: string
): Promise<Patient | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_COLUMNS)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error && error.code !== "PGRST116") throw new Error(`Failed to fetch patient: ${error.message}`);
  return (data as Patient) ?? null;
}

export async function createPatient(
  input: {
    fullName: string;
    age?: number | null;
    gender?: string | null;
    phone?: string | null;
    address?: string | null;
    medicalRecordNumber?: string | null;
  },
  clinicId: string
): Promise<Patient> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("patients")
    .insert({
      clinic_id: clinicId,
      full_name: input.fullName,
      age: input.age,
      gender: input.gender,
      phone: input.phone,
      address: input.address,
      medical_record_number: input.medicalRecordNumber,
    })
    .select(PATIENT_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create patient: ${error.message}`);
  return data as Patient;
}

export async function updatePatient(
  id: string,
  input: Partial<{
    fullName: string;
    age: number | null;
    gender: string | null;
    phone: string | null;
    address: string | null;
    medicalRecordNumber: string | null;
  }>,
  clinicId: string
): Promise<Patient> {
  const supabase = await createServerClient();
  const row: Record<string, unknown> = {};
  if (input.fullName !== undefined) row.full_name = input.fullName;
  if (input.age !== undefined) row.age = input.age;
  if (input.gender !== undefined) row.gender = input.gender;
  if (input.phone !== undefined) row.phone = input.phone;
  if (input.address !== undefined) row.address = input.address;
  if (input.medicalRecordNumber !== undefined) row.medical_record_number = input.medicalRecordNumber;

  const { data, error } = await supabase
    .from("patients")
    .update(row)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .select(PATIENT_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to update patient: ${error.message}`);
  return data as Patient;
}
