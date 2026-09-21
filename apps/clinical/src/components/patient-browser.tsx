"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  patientBasePath = "/patients",
}: {
  patients: Patient[];
  patientBasePath?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return patients;
    return patients.filter((patient) =>
      [patient.fullName, patient.phone, patient.medicalRecordNumber]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(normalized))
    );
  }, [patients, query]);

  return (
    <div className={styles.pageContent}>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Patients</p>
          <h1>Patient directory</h1>
          <p>Find a patient by name, phone, or medical record number.</p>
        </div>
        <span className={styles.directoryCount}>{patients.length} patients</span>
      </div>

      <label className={styles.directorySearch}>
        <Icon name="search" />
        <span className={styles.visuallyHidden}>Search patients</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, or record number" />
        {query ? <button type="button" onClick={() => setQuery("")}>Clear</button> : null}
      </label>

      {filteredPatients.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{patients.length === 0 ? "No patients yet" : "No matching patients"}</strong>
          <p>{patients.length === 0 ? "Patients created for this clinic will appear here." : "Try a different name, phone number, or record number."}</p>
        </div>
      ) : (
        <div className={styles.patientList} aria-label="Patients">
            {filteredPatients.map((patient) => (
                <Link
                  key={patient.id}
                  href={`${patientBasePath}/${patient.id}`}
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
                  <span className={styles.patientRowMeta}>{patient.medicalRecordNumber ?? patient.phone ?? "Record details unavailable"}</span>
                  <Icon name="chevron" />
                </Link>
            ))}
        </div>
      )}
    </div>
  );
}
