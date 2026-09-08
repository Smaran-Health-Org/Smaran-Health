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
