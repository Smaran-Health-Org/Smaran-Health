"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { PatientDirectoryEntry } from "@/types";
import styles from "@/components/clinical.module.css";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function readableDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

// Identity fields only. Clinical facts (weight, blood pressure, blood group,
// diabetes) are deliberately never rendered here, so the Clinic Desk view cannot
// surface doctor-only clinical interpretation.

export function PatientBrowser({
  patients,
  patientBasePath = "/patients",
}: {
  patients: PatientDirectoryEntry[];
  patientBasePath?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return patients;
    return patients.filter((patient) =>
      [patient.fullName, patient.phone, patient.medicalRecordNumber, patient.email]
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
          <p>Search, then click a name to see contact and record details.</p>
        </div>
        <span className={styles.directoryCount}>
          {filteredPatients.length === patients.length
            ? `${patients.length} patients`
            : `${filteredPatients.length} of ${patients.length}`}
        </span>
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
        <ul className={styles.directoryList} aria-label="Patients">
          {filteredPatients.map((patient) => {
            const hint = [patient.age != null ? `${patient.age} yrs` : null, patient.gender]
              .filter(Boolean)
              .join(" · ");
            const dateOfBirth = readableDate(patient.dateOfBirth);
            const addedOn = readableDate(patient.createdAt);
            return (
              <li key={patient.id}>
                <details className={styles.patientEntry}>
                  <summary>
                    <span className={styles.avatar}>{initials(patient.fullName)}</span>
                    <span className={styles.directoryName}>
                      <strong>{patient.fullName}</strong>
                      <small>{hint || patient.phone || "No details recorded"}</small>
                    </span>
                    {patient.mergedIntoPatientId ? (
                      <span className={styles.mergedTag} title="This record was merged into another patient">
                        Merged
                      </span>
                    ) : null}
                    <span className={styles.directoryChevron} aria-hidden="true">
                      <Icon name="chevron" />
                    </span>
                  </summary>
                  <div className={styles.patientEntryBody}>
                    <dl className={styles.patientFacts}>
                      <div>
                        <dt>Phone</dt>
                        <dd>{patient.phone ?? "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Record number</dt>
                        <dd>{patient.medicalRecordNumber ?? "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Age</dt>
                        <dd>{patient.age != null ? `${patient.age} years` : "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Gender</dt>
                        <dd>{patient.gender ?? "Not recorded"}</dd>
                      </div>
                      {dateOfBirth ? (
                        <div>
                          <dt>Date of birth</dt>
                          <dd>{dateOfBirth}</dd>
                        </div>
                      ) : null}
                      {patient.email ? (
                        <div>
                          <dt>Email</dt>
                          <dd>{patient.email}</dd>
                        </div>
                      ) : null}
                      {addedOn ? (
                        <div>
                          <dt>Added</dt>
                          <dd>{addedOn}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <Link className={styles.primaryButton} href={`${patientBasePath}/${patient.id}`}>
                      Open full profile <Icon name="arrowRight" />
                    </Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
