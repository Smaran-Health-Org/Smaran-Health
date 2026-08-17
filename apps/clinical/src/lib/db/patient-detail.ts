import { getPatient } from "./patients";
import { getConsultationsWithNotes, type ConsultationWithNote } from "./consultations";
import { getFollowUpMemory, type FollowUpMemory } from "./follow-up-memory";
import type { Patient } from "@/types";

export type PatientDetail = {
  patient: Patient;
  consultations: ConsultationWithNote[];
  memory: FollowUpMemory;
};

export async function getPatientDetail(
  id: string,
  clinicId: string
): Promise<PatientDetail | null> {
  const patient = await getPatient(id, clinicId);
  if (!patient) return null;

  const [consultations, memory] = await Promise.all([
    getConsultationsWithNotes(id, clinicId),
    getFollowUpMemory(id, clinicId),
  ]);

  return { patient, consultations, memory };
}
