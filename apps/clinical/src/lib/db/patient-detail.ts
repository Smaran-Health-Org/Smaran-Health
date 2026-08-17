import { getPatient } from "./patients";
import { getPatientTimeline } from "./timeline";
import { getConsultations } from "./consultations";
import { getFollowUpMemory, type FollowUpMemory } from "./follow-up-memory";
import type { Patient, PatientTimelineEvent, Consultation } from "@/types";

export type PatientDetail = {
  patient: Patient;
  timeline: PatientTimelineEvent[];
  consultations: Consultation[];
  memory: FollowUpMemory;
};

export async function getPatientDetail(
  id: string,
  clinicId: string
): Promise<PatientDetail | null> {
  const patient = await getPatient(id, clinicId);
  if (!patient) return null;

  const [timeline, consultations, memory] = await Promise.all([
    getPatientTimeline(id, clinicId),
    getConsultations(id, clinicId),
    getFollowUpMemory(id, clinicId),
  ]);

  return { patient, timeline, consultations, memory };
}
