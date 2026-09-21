import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  PATIENT_NAME_SIMILARITY_THRESHOLD,
  normalizePatientName,
  normalizePatientPhone,
  patientNameSimilarity,
  patientPhoneMatchKeys,
} from "@/lib/identity";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Patient, PatientDirectoryEntry } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const IDENTITY_PATIENT_COLUMNS =
  "id, clinicId:clinic_id, fullName:full_name, normalizedName:normalized_name, age, dateOfBirth:date_of_birth, gender, phone, normalizedPhone:normalized_phone, email, normalizedEmail:normalized_email, address, medicalRecordNumber:medical_record_number, mergedIntoPatientId:merged_into_patient_id, mergedAt:merged_at, mergedBy:merged_by, createdAt:created_at, updatedAt:updated_at";

const PATIENT_COLUMNS = `${IDENTITY_PATIENT_COLUMNS}, weightKg:weight_kg, heightCm:height_cm, bloodPressure:blood_pressure, bloodGroup:blood_group, hasDiabetes:has_diabetes`;

/**
 * Identity columns only, for administrative/operational (Clinic Desk) surfaces.
 * Clinical columns are intentionally absent so admin/assistant roles cannot
 * receive doctor-only clinical interpretation in a directory or search payload.
 */
export const PATIENT_DIRECTORY_COLUMNS = IDENTITY_PATIENT_COLUMNS;

/** Patient fields that carry doctor-only clinical interpretation. */
export const CLINICAL_PATIENT_FIELDS = [
  "weightKg",
  "heightCm",
  "bloodPressure",
  "bloodGroup",
  "hasDiabetes",
] as const;

/**
 * Strip doctor-only clinical facts before a patient record crosses to an
 * operational surface.
 */
export function toPatientDirectoryEntry(patient: Patient): PatientDirectoryEntry {
  const entry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patient)) {
    if ((CLINICAL_PATIENT_FIELDS as readonly string[]).includes(key)) continue;
    entry[key] = value;
  }
  return entry as PatientDirectoryEntry;
}

export type DuplicatePatientCandidate = Pick<
  Patient,
  "id" | "fullName" | "phone" | "dateOfBirth" | "age" | "gender" | "medicalRecordNumber"
> & {
  nameSimilarity: number;
  matchKind: "exact_name_and_phone" | "similar_name_and_phone";
};

type DuplicatePatientRow = {
  id: string;
  fullName: string;
  normalizedName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  medicalRecordNumber: string | null;
};

export async function findPossiblePatientDuplicatesWithClient(
  supabase: SupabaseClient,
  clinicId: string,
  input: { fullName: string; phone: string }
): Promise<DuplicatePatientCandidate[]> {
  const phoneKeys = patientPhoneMatchKeys(input.phone);
  if (phoneKeys.length === 0) return [];

  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, fullName:full_name, normalizedName:normalized_name, phone, dateOfBirth:date_of_birth, age, gender, medicalRecordNumber:medical_record_number"
    )
    .eq("clinic_id", clinicId)
    .is("merged_into_patient_id", null)
    .in("normalized_phone", phoneKeys)
    .limit(20);

  if (error) throw new Error(`Failed to check patient duplicates: ${error.message}`);

  return ((data as unknown as DuplicatePatientRow[]) ?? [])
    .map((patient) => {
      const nameSimilarity = patientNameSimilarity(input.fullName, patient.normalizedName);
      return {
        id: patient.id,
        fullName: patient.fullName,
        phone: patient.phone,
        dateOfBirth: patient.dateOfBirth,
        age: patient.age,
        gender: patient.gender,
        medicalRecordNumber: patient.medicalRecordNumber,
        nameSimilarity,
        matchKind:
          nameSimilarity === 1
            ? ("exact_name_and_phone" as const)
            : ("similar_name_and_phone" as const),
      };
    })
    .filter((patient) => patient.nameSimilarity >= PATIENT_NAME_SIMILARITY_THRESHOLD)
    .sort((left, right) => right.nameSimilarity - left.nameSimilarity)
    .slice(0, 10);
}

export async function findPossiblePatientDuplicates(
  clinicId: string,
  input: { fullName: string; phone: string }
): Promise<DuplicatePatientCandidate[]> {
  const supabase = await createServerClient();
  return findPossiblePatientDuplicatesWithClient(supabase, clinicId, input);
}

export type PatientQueryOptions = { search?: string; page?: number; pageSize?: number };

async function queryPatients<T>(
  columns: string,
  clinicId: string,
  opts?: PatientQueryOptions
): Promise<{ data: T[]; total: number }> {
  const supabase = await createServerClient();
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("patients")
    .select(columns, { count: "exact" })
    .eq("clinic_id", clinicId)
    .is("merged_into_patient_id", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts?.search) {
    const safeSearch = opts.search.replace(/[%_,().]/g, " ").trim();
    if (safeSearch) {
      query = query.or(`full_name.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to fetch patients: ${error.message}`);
  return { data: (data as T[]) ?? [], total: count ?? 0 };
}

export async function getPatients(
  clinicId: string,
  opts?: PatientQueryOptions
): Promise<{ data: Patient[]; total: number }> {
  return queryPatients<Patient>(PATIENT_COLUMNS, clinicId, opts);
}

/**
 * Patient directory/search for operational surfaces: identity fields only.
 */
export async function getPatientDirectory(
  clinicId: string,
  opts?: PatientQueryOptions
): Promise<{ data: PatientDirectoryEntry[]; total: number }> {
  return queryPatients<PatientDirectoryEntry>(PATIENT_DIRECTORY_COLUMNS, clinicId, opts);
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
    dateOfBirth?: string | null;
    gender?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    medicalRecordNumber?: string | null;
    weightKg?: number | null;
    heightCm?: number | null;
    bloodPressure?: string | null;
    bloodGroup?: string | null;
    hasDiabetes?: boolean | null;
  },
  clinicId: string
): Promise<Patient> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("patients")
    .insert({
      clinic_id: clinicId,
      full_name: input.fullName,
      normalized_name: normalizePatientName(input.fullName),
      age: input.age,
      date_of_birth: input.dateOfBirth,
      gender: input.gender,
      phone: input.phone,
      normalized_phone: normalizePatientPhone(input.phone),
      email: input.email,
      normalized_email: input.email?.trim().toLowerCase() || null,
      address: input.address,
      medical_record_number: input.medicalRecordNumber,
      weight_kg: input.weightKg,
      height_cm: input.heightCm,
      blood_pressure: input.bloodPressure,
      blood_group: input.bloodGroup,
      has_diabetes: input.hasDiabetes,
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
    dateOfBirth: string | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    medicalRecordNumber: string | null;
    weightKg: number | null;
    heightCm: number | null;
    bloodPressure: string | null;
    bloodGroup: string | null;
    hasDiabetes: boolean | null;
  }>,
  clinicId: string
): Promise<Patient> {
  const supabase = await createServerClient();
  const row: Record<string, unknown> = {};
  if (input.fullName !== undefined) {
    row.full_name = input.fullName;
    row.normalized_name = normalizePatientName(input.fullName);
  }
  if (input.age !== undefined) row.age = input.age;
  if (input.dateOfBirth !== undefined) row.date_of_birth = input.dateOfBirth;
  if (input.gender !== undefined) row.gender = input.gender;
  if (input.phone !== undefined) {
    row.phone = input.phone;
    row.normalized_phone = normalizePatientPhone(input.phone);
  }
  if (input.email !== undefined) {
    row.email = input.email?.trim().toLowerCase() || null;
    row.normalized_email = input.email?.trim().toLowerCase() || null;
  }
  if (input.address !== undefined) row.address = input.address;
  if (input.medicalRecordNumber !== undefined) row.medical_record_number = input.medicalRecordNumber;
  if (input.weightKg !== undefined) row.weight_kg = input.weightKg;
  if (input.heightCm !== undefined) row.height_cm = input.heightCm;
  if (input.bloodPressure !== undefined) row.blood_pressure = input.bloodPressure;
  if (input.bloodGroup !== undefined) row.blood_group = input.bloodGroup;
  if (input.hasDiabetes !== undefined) row.has_diabetes = input.hasDiabetes;

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
