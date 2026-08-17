"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StartConsultationButton } from "@/components/start-consultation";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icons";
import { formatDate, formatRelativeDay } from "@/lib/status";
import type { Patient, Consultation } from "@/types";
import styles from "@/components/clinical.module.css";

type MemoryPreview = {
  summary: string | null;
  lastVisitAt: string | null;
};

type ConsultationPreview = Consultation & {
  noteStatus?: string | null;
  noteSummary?: string | null;
};

type PatientDetail = {
  patient: Patient;
  consultations: ConsultationPreview[];
  memory: MemoryPreview | null;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function patientMeta(patient: Patient): string {
  return [
    patient.age != null ? `${patient.age} years` : null,
    patient.gender,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PatientBrowser({ patients }: { patients: Patient[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    patients[0]?.id ?? null
  );
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(() => patients.length > 0);
  const [error, setError] = useState<string | null>(null);

  function selectPatient(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    fetch(`/api/patients/${selectedId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load patient details");
        return res.json();
      })
      .then((data: PatientDetail) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const detailMatches = detail?.patient?.id === selectedId;
  const selectedPatient = detailMatches ? detail!.patient : undefined;
  const memory = detailMatches ? detail!.memory : null;
  const consultations = detailMatches ? detail!.consultations : [];

  return (
    <div className={styles.pageContent}>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Patients</p>
          <h1>Patient list</h1>
          <p>Select a patient to preview, then start or resume a consultation.</p>
        </div>
        <Link href="/new-consultation?new=1" className={styles.primaryButton}>
          <Icon name="plus" /> New patient
        </Link>
      </div>

      {patients.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No patients yet</strong>
          <p>Patients created for this clinic will appear here.</p>
        </div>
      ) : (
        <div className={styles.patientsLayout}>
          <div className={styles.patientList} role="listbox" aria-label="Patients">
            {patients.map((patient) => {
              const isSelected = patient.id === selectedId;
              return (
                <button
                  type="button"
                  key={patient.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.patientRow} ${isSelected ? styles.selectedRow : ""}`}
                  onClick={() => selectPatient(patient.id)}
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
                </button>
              );
            })}
          </div>

          <aside className={styles.patientDetailPanel} aria-live="polite">
            {!selectedPatient && loading && (
              <div className={styles.detailEmpty}>Loading…</div>
            )}
            {!selectedPatient && !loading && error && (
              <div className={styles.detailEmpty}>
                <strong>Could not load details</strong>
                <p>{error}</p>
              </div>
            )}
            {selectedPatient && (
              <>
                <div className={styles.detailHeader}>
                  <span className={styles.detailAvatar}>
                    {initials(selectedPatient.fullName)}
                  </span>
                  <div>
                    <strong>{selectedPatient.fullName}</strong>
                    <span>{patientMeta(selectedPatient) || "Patient record"}</span>
                  </div>
                </div>

                <div className={styles.detailMeta}>
                  <div>
                    <Icon name="phone" />
                    <span>{selectedPatient.phone ?? "No phone"}</span>
                  </div>
                  <div>
                    <Icon name="idCard" />
                    <span>{selectedPatient.medicalRecordNumber ?? "No MRN"}</span>
                  </div>
                  <div>
                    <Icon name="mapPin" />
                    <span>{selectedPatient.address ?? "No address"}</span>
                  </div>
                </div>

                <div className={styles.detailSection}>
                  <p className={styles.eyebrow}>Follow-up memory</p>
                  <h3>Before the next visit</h3>
                  {!memory?.summary ? (
                    <p className={styles.detailMuted}>No approved visits yet.</p>
                  ) : (
                    <>
                      {memory.lastVisitAt && (
                        <time className={styles.detailMuted}>
                          Last visit · {formatDate(memory.lastVisitAt)}
                        </time>
                      )}
                      <p className={styles.detailSummary}>{memory.summary}</p>
                    </>
                  )}
                </div>

                <div className={styles.detailSection}>
                  <p className={styles.eyebrow}>Consultations</p>
                  <h3>Recent visits</h3>
                  {consultations.length === 0 ? (
                    <p className={styles.detailMuted}>No consultations yet.</p>
                  ) : (
                    <ul className={styles.detailVisits}>
                      {consultations.slice(0, 3).map((consultation) => (
                        <li key={consultation.id}>
                          <time>{formatRelativeDay(consultation.startedAt)}</time>
                          <StatusBadge status={consultation.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={styles.detailActions}>
                  <StartConsultationButton patientId={selectedPatient.id} />
                  <Link
                    href={`/patients/${selectedPatient.id}`}
                    className={styles.secondaryButton}
                  >
                    View full profile
                  </Link>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
