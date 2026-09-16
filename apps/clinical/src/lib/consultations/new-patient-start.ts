export type NewPatientDirectStartCommand = {
  patientId: string;
  commandId: string;
};

/** Keeps a created patient's direct-start command stable across transport retry. */
export function directStartCommandForNewPatient(
  existing: NewPatientDirectStartCommand | null,
  patientId: string,
  createCommandId: () => string = () => crypto.randomUUID()
): NewPatientDirectStartCommand {
  return existing ?? { patientId, commandId: createCommandId() };
}
