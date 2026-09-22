import type { PreconsultBrief } from "@/lib/preconsult/contract";

export function preconsultVerificationLabel(value: string) {
  return value === "confirmed"
    ? "Doctor-confirmed"
    : value === "proposed"
      ? "Proposed — review required"
      : value === "patient_reported_unconfirmed"
        ? "Patient-reported — unconfirmed"
        : value === "external_unconfirmed"
          ? "External evidence — unconfirmed"
          : "Needs Review";
}

type WhyTodayProvenance = PreconsultBrief["whyToday"]["provenance"];

function failSafeWhyTodayProvenance(value: never): "Needs Review" {
  void value;
  return "Needs Review";
}

/**
 * The reason for visit is only directly patient-reported when its provenance
 * says so. Reception-assisted and unknown entries remain visibly unverified.
 */
export function whyTodayProvenanceLabel(provenance: WhyTodayProvenance): string {
  switch (provenance) {
    case "patient":
      return "Patient-reported — unconfirmed";
    case "reception_assisted":
      return "Reception-reported — unconfirmed";
    case "unknown":
      return "Needs Review";
  }

  return failSafeWhyTodayProvenance(provenance);
}
