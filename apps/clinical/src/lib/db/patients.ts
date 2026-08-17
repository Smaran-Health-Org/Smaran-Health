import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Patient } from "@/types";

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
      full_name: input.fullName,
      age: input.age ?? null,
      gender: input.gender ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      medical_record_number: input.medicalRecordNumber ?? null,
      clinic_id: clinicId,
    })
    .select("*")
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};
  if (input.fullName !== undefined) updateData.full_name = input.fullName;
  if (input.age !== undefined) updateData.age = input.age;
  if (input.gender !== undefined) updateData.gender = input.gender;
  if (input.phone !== undefined) updateData.phone = input.phone;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.medicalRecordNumber !== undefined) updateData.medical_record_number = input.medicalRecordNumber;

  const { data, error } = await supabase
    .from("patients")
    .update(updateData)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update patient: ${error.message}`);
  return data as Patient;
}
