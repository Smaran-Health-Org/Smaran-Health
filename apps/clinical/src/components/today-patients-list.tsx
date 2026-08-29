"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";

type TodayPatient = {
  id: string;
  fullName: string;
  consultationStatus: string;
  consultationId: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function completionStatus(status: string): { label: string; tone: string } {
  switch (status) {
    case "approved":
      return { label: "Completed", tone: "success" };
    case "failed":
    case "rejected":
      return { label: "Incomplete", tone: "danger" };
    case "draft":
      return { label: "Not completed", tone: "neutral" };
    default:
      return { label: "In progress", tone: "info" };
  }
}

export function TodayPatientsList({ patients }: { patients: TodayPatient[] }) {
  const [query, setQuery] = useState("");
  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return patients;
    return patients.filter((patient) =>
      patient.fullName.toLocaleLowerCase().includes(normalized)
    );
  }, [patients, query]);

  return (
    <section className={styles.panel}>
      <div className={styles.todayPatientsHeader}>
        <p className={styles.eyebrow}>Today&apos;s patients</p>
        <label className={styles.patientSearch}>
          <Icon name="search" />
          <span className={styles.visuallyHidden}>Search today&apos;s patients by name</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search patient name"
          />
        </label>
      </div>

      {patients.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No patients today</strong>
          <p>Patients with a consultation today will appear here.</p>
        </div>
      ) : filteredPatients.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No matching patients</strong>
          <p>Try a different patient name.</p>
        </div>
      ) : (
        <ul className={styles.activityList}>
          {filteredPatients.map((patient) => {
            const status = completionStatus(patient.consultationStatus);
            const actionHref = patient.consultationStatus === "approved"
              ? `/patients/${patient.id}/today?consultation=${patient.consultationId}`
              : `/consultations/${patient.consultationId}`;
            return (
              <li key={patient.id}>
                <Link href={actionHref} className={styles.activityItem}>
                  <span className={styles.avatar}>{initials(patient.fullName)}</span>
                  <div className={styles.activityMain}>
                    <strong>{patient.fullName}</strong>
                    <span>Today</span>
                  </div>
                  <span className={styles.statusBadge} data-tone={status.tone}>
                    {status.label}
                  </span>
                  <Icon name="chevron" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
