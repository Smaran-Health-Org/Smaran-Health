import { getPatient } from "./patients";
import { getPatientTimeline } from "./timeline";
import { getConsultations } from "./consultations";
import type { Patient, PatientTimelineEvent, Consultation } from "@/types";

export type PatientDetail = {
  patient: Patient;
  timeline: PatientTimelineEvent[];
  consultations: Consultation[];
};

export async function getPatientDetail(
  id: string,
  clinicId: string
): Promise<PatientDetail | null> {
  const patient = await getPatient(id, clinicId);
  if (!patient) return null;

  const [timeline, consultations] = await Promise.all([
    getPatientTimeline(id, clinicId),
    getConsultations(id, clinicId),
  ]);

  return { patient, timeline, consultations };
}
