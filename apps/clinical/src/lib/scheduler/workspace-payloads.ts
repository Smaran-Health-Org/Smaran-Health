export function optionalDurationOverride(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 5 && duration <= 60 ? duration : undefined;
}

export function hasValidDurationOverride(value: string): boolean {
  return value.trim() === "" || optionalDurationOverride(value) !== undefined;
}

export function selectedDoctorTypeId(currentTypeId: string, availableTypeIds: readonly string[]): string {
  return currentTypeId && !availableTypeIds.includes(currentTypeId) ? "" : currentTypeId;
}

export function displayedBookingDuration(input: {
  typeId: string;
  appointmentTypes: ReadonlyArray<{ id: string; resolvedDurationMinutes: number }>;
  effectiveDefaultDurationMinutes: number;
}): number {
  return input.appointmentTypes.find((type) => type.id === input.typeId)?.resolvedDurationMinutes
    ?? input.effectiveDefaultDurationMinutes;
}

export function bookingSemanticIdentity(input: {
  patientId: string | undefined;
  doctorId: string;
  date: string;
  time: string;
  durationOverride: string;
  typeId: string;
  staffNote: string;
}): string {
  return `${input.patientId}|${input.doctorId}|${input.date}|${input.time}|${input.durationOverride}|${input.typeId}|${input.staffNote}`;
}
