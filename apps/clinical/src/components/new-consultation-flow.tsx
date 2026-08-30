"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StartConsultationButton } from "@/components/start-consultation";
import { Icon } from "@/components/icons";
import type { Patient } from "@/types";
import styles from "@/components/clinical.module.css";

type Mode = "existing" | "new";

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

export function NewConsultationFlow({
  patients,
  initialMode,
}: {
  patients: Patient[];
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode ?? "existing");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (patient) =>
        patient.fullName.toLowerCase().includes(q) ||
        (patient.phone ?? "").toLowerCase().includes(q) ||
        (patient.medicalRecordNumber ?? "").toLowerCase().includes(q)
    );
  }, [patients, search]);

  return (
    <div className={styles.pageContent}>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>New consultation</p>
          <h1>Who are you seeing?</h1>
        </div>
      </div>

      {initialMode !== "new" && <div className={styles.segmentedControl} role="tablist" aria-label="Patient type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "existing"}
          className={mode === "existing" ? styles.segmentActive : undefined}
          onClick={() => setMode("existing")}
        >
          <Icon name="users" /> Existing patient
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "new"}
          className={mode === "new" ? styles.segmentActive : undefined}
          onClick={() => setMode("new")}
        >
          <Icon name="plus" /> New patient
        </button>
      </div>}

      {mode === "existing" ? (
        <section aria-label="Existing patients">
          <div className={styles.searchField}>
            <Icon name="search" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, phone or MRN"
              aria-label="Search patients"
            />
          </div>

          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{patients.length === 0 ? "No patients yet" : "No matching patients"}</strong>
              <p>
                {patients.length === 0
                  ? "Add your first patient to get started."
                  : "Try a different search, or add them as a new patient."}
              </p>
            </div>
          ) : (
            <ul className={styles.patientStartList}>
              {filtered.map((patient) => (
                <li key={patient.id} className={styles.patientStartRow}>
                  <span className={styles.avatar}>{initials(patient.fullName)}</span>
                  <div className={styles.patientStartMain}>
                    <strong>{patient.fullName}</strong>
                    <span>{patientMeta(patient) || "Patient record"}</span>
                  </div>
                  <StartConsultationButton patientId={patient.id} label="Start" />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <NewPatientForm />
      )}
    </div>
  );
}

function NewPatientForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [checking, setChecking] = useState(false);
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validateIdentity(): string | null {
    const name = fullName.trim();
    if (!name) return "Name is required.";
    if (phone.trim() && phone.replace(/\D/g, "").length < 6) {
      return "Enter a valid phone number, or leave it blank.";
    }
    return null;
  }

  function resetDuplicateReview() {
    setDetailsVisible(false);
    setDuplicateOverride(false);
    setCandidates([]);
    setError(null);
  }

  async function checkForExistingPatient() {
    const identityError = validateIdentity();
    if (identityError) {
      setError(identityError);
      return;
    }

    if (!phone.trim()) {
      setCandidates([]);
      setDetailsVisible(true);
      setError(null);
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        matchName: fullName.trim(),
        matchPhone: phone.trim(),
      });
      const response = await fetch(`/api/patients?${params.toString()}`);
      if (!response.ok) throw new Error("Could not check existing patients. Please retry.");
      const result = (await response.json()) as { data?: DuplicateCandidate[] };
      const possibleMatches = result.data ?? [];
      setCandidates(possibleMatches);
      setDetailsVisible(possibleMatches.length === 0);
      setDuplicateOverride(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check existing patients.");
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const identityError = validateIdentity();
    if (identityError) {
      setError(identityError);
      return;
    }
    if (age.trim() && !Number.isInteger(Number(age))) {
      setError("Age must be a whole number.");
      return;
    }
    const name = fullName.trim();

    setSubmitting(true);
    setError(null);

    try {
      const createRes = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: name,
          age: age.trim() ? Number(age) : null,
          dateOfBirth: dateOfBirth || null,
          gender: gender || null,
          phone: phone.trim() || null,
          duplicateOverride: duplicateOverride ? "confirmed_distinct_patient" : undefined,
        }),
      });

      if (createRes.status === 409) {
        const result = (await createRes.json()) as {
          code?: string;
          details?: { candidates?: DuplicateCandidate[] };
        };
        if (result.code === "possible_duplicate") {
          setCandidates(result.details?.candidates ?? []);
          setDetailsVisible(false);
          setDuplicateOverride(false);
          setError("A possible match appeared while saving. Review it before continuing.");
          setSubmitting(false);
          return;
        }
      }
      if (!createRes.ok) throw new Error("Could not create the patient record.");

      const patient: Patient = await createRes.json();

      const consultRes = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id }),
      });

      if (!consultRes.ok) {
        throw new Error(
          "Patient was created, but the consultation could not be started. Please find them in Patients and try again."
        );
      }

      const consultation = await consultRes.json();
      router.push(`/consultations/${consultation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="New patient">
      <form className={styles.newPatientForm} onSubmit={handleSubmit}>
        <div className={styles.formIntro}>
          <strong>Check identity first</strong>
          <span>We use name and phone as matching signals. A possible match never merges automatically.</span>
        </div>
        <div className={styles.formGrid}>
          <label className={`${styles.formField} ${styles.fieldFull}`}>
            <span>Full name</span>
            <input
              type="text"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                resetDuplicateReview();
              }}
              placeholder="e.g. Aarav Mehta"
              autoFocus
              required
            />
          </label>

          <label className={`${styles.formField} ${styles.fieldFull}`}>
            <span>Phone (optional)</span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                resetDuplicateReview();
              }}
              placeholder="e.g. +91 98765 43210"
            />
          </label>
        </div>

        {!detailsVisible && candidates.length === 0 ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={checking}
            onClick={checkForExistingPatient}
          >
            <Icon name="search" />
            {checking ? "Checking…" : "Check for existing patient"}
          </button>
        ) : null}

        {candidates.length > 0 && !detailsVisible ? (
          <div className={styles.duplicateReview} role="alert">
            <strong>Possible existing patient</strong>
            <p>Confirm whether one of these records is the same person before creating another.</p>
            <ul>
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <div>
                    <strong>{candidate.fullName}</strong>
                    <span>{duplicateCandidateMeta(candidate)}</span>
                  </div>
                  <div className={styles.duplicateActions}>
                    <Link href={`/patients/${candidate.id}`}>Review profile</Link>
                    <StartConsultationButton patientId={candidate.id} label="Use this patient" />
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setDuplicateOverride(true);
                setDetailsVisible(true);
                setError(null);
              }}
            >
              Continue as a different patient
            </button>
          </div>
        ) : null}

        {detailsVisible ? (
          <div className={`${styles.formGrid} ${styles.demographicFields}`}>
            <label className={styles.formField}>
              <span>Date of birth (preferred)</span>
              <input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={dateOfBirth}
                onChange={(event) => {
                  setDateOfBirth(event.target.value);
                  if (event.target.value) setAge("");
                }}
              />
            </label>

            <label className={styles.formField}>
              <span>Age (if DOB unknown)</span>
              <input
                type="number"
                min={0}
                max={150}
                inputMode="numeric"
                value={age}
                disabled={Boolean(dateOfBirth)}
                onChange={(event) => setAge(event.target.value)}
                placeholder="e.g. 42"
              />
            </label>

            <label className={`${styles.formField} ${styles.fieldFull}`}>
              <span>Gender</span>
              <select value={gender} onChange={(event) => setGender(event.target.value)}>
                <option value="">Not recorded</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>
        ) : null}

        {error ? <p className={styles.formError}>{error}</p> : null}

        {detailsVisible ? (
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            <Icon name="plus" />
            {submitting ? "Starting…" : "Add patient & start consultation"}
          </button>
        ) : null}
      </form>
    </section>
  );
}

type DuplicateCandidate = {
  id: string;
  fullName: string;
  phone: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  medicalRecordNumber: string | null;
};

function duplicateCandidateMeta(candidate: DuplicateCandidate): string {
  return [
    candidate.phone,
    candidate.dateOfBirth ? `DOB ${candidate.dateOfBirth}` : null,
    candidate.age != null ? `${candidate.age} years` : null,
    candidate.gender,
    candidate.medicalRecordNumber ? `MRN ${candidate.medicalRecordNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
