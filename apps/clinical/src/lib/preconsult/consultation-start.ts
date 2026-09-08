import { preconsultBriefSchema, type PreconsultBrief } from "@/lib/preconsult/contract";
export { preconsultVerificationLabel } from "@/lib/preconsult/verification-label";

export type PreconsultBriefAtConsultationStart =
  | { status: "brief_available"; briefVersionId: string; payload: PreconsultBrief }
  | { status: "none_available" }
  | { status: "unavailable" };

export type PreconsultBriefStartContext = {
  consultationId: string;
  clinicId: string;
  patientId: string;
};

export type PreconsultBriefStartSnapshotRecord = {
  consultation_id?: unknown;
  clinic_id?: unknown;
  patient_id?: unknown;
  origin_patient_id?: unknown;
  brief_version_id?: unknown;
  availability?: unknown;
};

export type PreconsultBriefVersionRecord = {
  id?: unknown;
  consultation_id?: unknown;
  clinic_id?: unknown;
  patient_id?: unknown;
  origin_patient_id?: unknown;
  payload?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const unavailable = (): PreconsultBriefAtConsultationStart => ({ status: "unavailable" });

/**
 * Resolves only the immutable version captured when the Encounter entered
 * in_consultation. This deliberately accepts no current-pointer data.
 */
export function resolvePreconsultBriefAtConsultationStart(
  context: PreconsultBriefStartContext,
  snapshot: PreconsultBriefStartSnapshotRecord | null,
  version: PreconsultBriefVersionRecord | null,
): PreconsultBriefAtConsultationStart {
  if (!snapshot
    || stringValue(snapshot.consultation_id) !== context.consultationId
    || stringValue(snapshot.clinic_id) !== context.clinicId
    || stringValue(snapshot.patient_id) !== context.patientId) {
    return unavailable();
  }

  if (snapshot.availability === "none_available") {
    return snapshot.brief_version_id == null ? { status: "none_available" } : unavailable();
  }

  const briefVersionId = stringValue(snapshot.brief_version_id);
  const snapshotOriginPatientId = stringValue(snapshot.origin_patient_id);
  const versionOriginPatientId = stringValue(version?.origin_patient_id);
  if (snapshot.availability !== "brief_available" || !briefVersionId || !version
    || stringValue(version.id) !== briefVersionId
    || stringValue(version.consultation_id) !== context.consultationId
    || stringValue(version.clinic_id) !== context.clinicId
    || stringValue(version.patient_id) !== context.patientId
    || !snapshotOriginPatientId
    || !versionOriginPatientId
    || versionOriginPatientId !== snapshotOriginPatientId) {
    return unavailable();
  }

  const payload = preconsultBriefSchema.safeParse(version.payload);
  return payload.success
    ? { status: "brief_available", briefVersionId, payload: payload.data }
    : unavailable();
}
