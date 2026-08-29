"use client";

import { useMemo, useState, type FormEvent } from "react";
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
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [bloodPressure, setBloodPressure] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [diabetesHistory, setDiabetesHistory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = fullName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (age.trim() && !Number.isInteger(Number(age))) {
      setError("Age must be a whole number.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const createRes = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: name,
          age: age.trim() ? Number(age) : null,
          gender: gender || null,
          phone: phone.trim() || null,
          weightKg: weightKg.trim() ? Number(weightKg) : null,
          heightCm: heightCm.trim() ? Number(heightCm) : null,
          bloodPressure: bloodPressure.trim() || null,
          bloodGroup: bloodGroup || null,
          hasDiabetes: diabetesHistory === "yes" ? true : diabetesHistory === "no" ? false : null,
        }),
      });

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
        <div className={styles.formGrid}>
          <label className={`${styles.formField} ${styles.fieldFull}`}>
            <span>Full name</span>
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="e.g. Aarav Mehta"
              autoFocus
              required
            />
          </label>

          <label className={styles.formField}>
            <span>Weight (kg)</span>
            <input type="number" min="0.1" max="500" step="0.1" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} placeholder="e.g. 72.5" />
          </label>

          <label className={styles.formField}>
            <span>Height (cm)</span>
            <input type="number" min="0.1" max="300" step="0.1" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} placeholder="e.g. 168" />
          </label>

          <label className={styles.formField}>
            <span>Blood pressure</span>
            <input type="text" inputMode="numeric" value={bloodPressure} onChange={(event) => setBloodPressure(event.target.value)} placeholder="e.g. 120/80" pattern="[0-9]{2,3}/[0-9]{2,3}" />
          </label>

          <label className={styles.formField}>
            <span>Blood group</span>
            <select value={bloodGroup} onChange={(event) => setBloodGroup(event.target.value)}>
              <option value="">Not recorded</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
          </label>

          <label className={`${styles.formField} ${styles.fieldFull}`}>
            <span>Documented diabetes history</span>
            <select value={diabetesHistory} onChange={(event) => setDiabetesHistory(event.target.value)}>
              <option value="">Not recorded</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className={styles.formField}>
            <span>Age</span>
            <input
              type="number"
              min={0}
              max={150}
              inputMode="numeric"
              value={age}
              onChange={(event) => setAge(event.target.value)}
              placeholder="e.g. 42"
            />
          </label>

          <label className={styles.formField}>
            <span>Gender</span>
            <select value={gender} onChange={(event) => setGender(event.target.value)}>
              <option value="">Prefer not to say</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label className={`${styles.formField} ${styles.fieldFull}`}>
            <span>Phone (optional)</span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="e.g. +91 98765 43210"
            />
          </label>
        </div>

        {error ? <p className={styles.formError}>{error}</p> : null}

        <button type="submit" className={styles.primaryButton} disabled={submitting}>
          <Icon name="plus" />
          {submitting ? "Starting…" : "Add patient & start consultation"}
        </button>
      </form>
    </section>
  );
}
