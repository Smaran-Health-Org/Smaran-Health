export type PatientBookingMessage = {
  kind: "warning" | "error";
  message: string;
};

type AvailabilityRequest = {
  isCurrent(): boolean;
};

// Keeps a request generation private while allowing the Portal to synchronously
// invalidate an in-flight response before React schedules effect cleanup.
export function createPatientAvailabilityRequestGeneration() {
  let current = 0;

  return {
    invalidate() {
      current += 1;
    },
    begin(): AvailabilityRequest {
      const request = ++current;
      return { isCurrent: () => request === current };
    },
  };
}

export function patientBookingMessageRole(message: PatientBookingMessage) {
  return message.kind === "error" ? "alert" : "status";
}
