import Link from "next/link";
import { Icon } from "@/components/icons";
import type { Patient } from "@/types";
import styles from "@/components/clinical.module.css";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function PatientBrowser({
  patients,
  patientHref = (patientId) => `/patients/${patientId}`,
}: {
  patients: Patient[];
  patientHref?: (patientId: string) => string;
}) {
  return (
    <div className={styles.pageContent}>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Patients</p>
          <h1>Patient list</h1>
          <p>Select a patient to view their full profile.</p>
        </div>
      </div>

      {patients.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No patients yet</strong>
          <p>Patients created for this clinic will appear here.</p>
        </div>
      ) : (
        <div className={styles.patientList} aria-label="Patients">
            {patients.map((patient) => (
                <Link
                  key={patient.id}
                  href={patientHref(patient.id)}
                  className={styles.patientRow}
                >
                  <span className={styles.avatar}>{initials(patient.fullName)}</span>
                  <span className={styles.patientRowMain}>
                    <strong>{patient.fullName}</strong>
                    <span>
                      {patient.age != null ? `${patient.age} years` : "Age not recorded"}
                      {patient.gender ? ` · ${patient.gender}` : ""}
                    </span>
                  </span>
                  <Icon name="chevron" />
                </Link>
            ))}
        </div>
      )}
    </div>
  );
}
