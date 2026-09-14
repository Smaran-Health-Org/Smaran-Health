"use client";

import { useState, type FormEvent } from "react";
import styles from "@/components/clinical.module.css";

type OperationalPatient = {
  id: string;
  email: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
};

export function OperationalPatientDetails({
  patient,
  previousVisits,
  visitStatus,
}: {
  patient: OperationalPatient;
  previousVisits: number;
  visitStatus?: string | null;
}) {
  const [details, setDetails] = useState(patient);
  const [dateOfBirth, setDateOfBirth] = useState(patient.dateOfBirth ?? "");
  const [age, setAge] = useState(patient.age === null ? "" : String(patient.age));
  const [gender, setGender] = useState(patient.gender ?? "");
  const [email, setEmail] = useState(patient.email ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function cancel() {
    setDateOfBirth(details.dateOfBirth ?? "");
    setAge(details.age === null ? "" : String(details.age));
    setGender(details.gender ?? "");
    setEmail(details.email ?? "");
    setError(null);
    setSaved(false);
    setEditing(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAge = age === "" ? null : Number(age);
    if (numericAge !== null && (!Number.isInteger(numericAge) || numericAge < 0 || numericAge > 150)) {
      setError("Age must be a whole number between 0 and 150.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/patients/${patient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateOfBirth: dateOfBirth || null,
          age: numericAge,
          gender: gender.trim() || null,
          email: email.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null) as (OperationalPatient & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "Patient details could not be saved.");
      setDetails(payload);
      setDateOfBirth(payload.dateOfBirth ?? "");
      setAge(payload.age === null ? "" : String(payload.age));
      setGender(payload.gender ?? "");
      setEmail(payload.email ?? "");
      setSaved(true);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Patient details could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${styles.panel} ${styles.operationalDetailsPanel}`}>
      <div className={styles.panelTitle}>
        <h2>Patient details</h2>
        {editing ? <span className={styles.panelHint}>Clinic operations</span> : (
          <button className={styles.compactButton} type="button" onClick={() => { setEditing(true); setSaved(false); }}>Edit details</button>
        )}
      </div>
      {visitStatus ? <div className={styles.patientLiveStatus}><span>Live visit status</span><strong>{visitStatus}</strong></div> : null}
      {editing ? (
        <form className={styles.operationalDetailsForm} onSubmit={submit}>
          <label className={styles.formField}><span>Date of birth</span><input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label>
          <label className={styles.formField}><span>Age</span><input type="number" min={0} max={150} step={1} value={age} onChange={(event) => setAge(event.target.value)} /></label>
          <label className={styles.formField}><span>Gender</span><input maxLength={50} value={gender} onChange={(event) => setGender(event.target.value)} /></label>
          <label className={styles.formField}><span>Email</span><input type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="patient@example.com" /></label>
          <div className={styles.operationalDetailsActions}>
            <button className={styles.primaryButton} disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
            <button className={styles.secondaryButton} type="button" disabled={busy} onClick={cancel}>Cancel</button>
          </div>
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
        </form>
      ) : (
        <>
          {saved ? <p className={styles.savedNotice} role="status">Patient details saved.</p> : null}
          <dl className={styles.operationalDetails}>
            <div><dt>Date of birth</dt><dd>{details.dateOfBirth || "Not recorded"}</dd></div>
            <div><dt>Age</dt><dd>{details.age ?? "Not recorded"}</dd></div>
            <div><dt>Gender</dt><dd>{details.gender || "Not recorded"}</dd></div>
            <div><dt>Email</dt><dd>{details.email || "Not recorded"}</dd></div>
            <div><dt>Previous visits</dt><dd>{previousVisits}</dd></div>
          </dl>
        </>
      )}
    </section>
  );
}
