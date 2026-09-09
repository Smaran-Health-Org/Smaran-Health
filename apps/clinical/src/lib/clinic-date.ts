export const CLINIC_TIME_ZONE = "Asia/Kolkata";

const CLINIC_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLINIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Returns a stable YYYY-MM-DD calendar date in the clinic timezone. */
export function clinicDateKey(date = new Date()): string {
  const parts = CLINIC_DATE_FORMATTER.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isOnOrBeforeClinicToday(value: string, now = new Date()): boolean {
  return value <= clinicDateKey(now);
}
