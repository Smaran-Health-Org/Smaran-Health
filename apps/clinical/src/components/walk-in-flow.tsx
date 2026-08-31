"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Patient } from "@/types";
import type { ClinicDoctor } from "@/lib/db/clinics";
import styles from "@/components/clinical.module.css";

type Candidate = Pick<Patient, "id" | "fullName" | "phone" | "dateOfBirth" | "age" | "gender">;

export function WalkInFlow({ patients, doctors }: { patients: Patient[]; doctors: ClinicDoctor[] }) {
  const router = useRouter();
  const requestRef = useRef<{ patientId: string; doctorId: string; key: string } | null>(null);
  const [query, setQuery] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searchResults, setSearchResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [distinctConfirmed, setDistinctConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ search: normalized, page: "1", pageSize: "20" });
        const response = await fetch(`/api/patients?${params}`, { signal: controller.signal });
        const payload = await response.json().catch(() => null) as { data?: Candidate[] } | null;
        if (!response.ok) throw new Error("Patient search is unavailable. Please try again.");
        setSearchResults(payload?.data ?? []);
      } catch (searchFailure) {
        if (controller.signal.aborted) return;
        setSearchError(searchFailure instanceof Error ? searchFailure.message : "Patient search is unavailable.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [patients, query]);

  function requestKey(patientId: string): string {
    const current = requestRef.current;
    if (current && current.patientId === patientId && current.doctorId === doctorId) return current.key;
    const next = { patientId, doctorId, key: crypto.randomUUID() };
    requestRef.current = next;
    return next.key;
  }

  async function addWalkIn(patientId: string) {
    if (!doctorId) {
      setError("A clinic doctor is required before a walk-in can be added.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/walk-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, doctorId, idempotencyKey: `walk-in-${requestKey(patientId)}` }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not add this walk-in.");
      router.push("/desk");
      router.refresh();
    } catch (walkInError) {
      setError(walkInError instanceof Error ? walkInError.message : "Could not add this walk-in.");
      setBusy(false);
    }
  }

  async function createAndAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fullName.trim() || phone.replace(/\D/g, "").length < 6) {
      setError("Enter the patient’s name and a valid phone number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!distinctConfirmed) {
        const params = new URLSearchParams({ matchName: fullName.trim(), matchPhone: phone.trim() });
        const duplicateResponse = await fetch(`/api/patients?${params}`);
        const duplicatePayload = await duplicateResponse.json() as { data?: Candidate[] };
        if (!duplicateResponse.ok) throw new Error("Could not check for an existing patient.");
        if ((duplicatePayload.data ?? []).length > 0) {
          setCandidates(duplicatePayload.data ?? []);
          setBusy(false);
          return;
        }
      }

      const response = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          duplicateOverride: distinctConfirmed ? "confirmed_distinct_patient" : undefined,
        }),
      });
      const payload = await response.json().catch(() => null) as (Patient & { error?: string }) | null;
      if (!response.ok || !payload?.id) throw new Error(payload?.error || "Could not create the patient record.");
      await addWalkIn(payload.id);
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "Could not add the patient.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.walkInGrid}>
      {doctors.length > 1 ? (
        <label className={styles.formField}><span>Doctor</span><select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label>
      ) : null}
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Step 1</p><h2>Find an existing patient</h2></div></div>
        <input className={styles.standaloneSearch} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or phone" aria-label="Search existing patient" />
        {query.trim() && searching ? <p className={styles.panelHint}>Searching clinic patients…</p> : null}
        {query.trim() && searchError ? <div className={styles.errorBanner} role="alert">{searchError}</div> : null}
        <ul className={styles.walkInPatientList}>
          {(query.trim() ? searchResults : patients.slice(0, 12)).map((patient) => <li key={patient.id}><div><strong>{patient.fullName}</strong><span>{patient.phone ?? "Phone not recorded"}</span></div><button className={styles.primaryButton} disabled={busy} onClick={() => void addWalkIn(patient.id)}>Use existing patient</button></li>)}
        </ul>
        {!searching && query.trim() && searchResults.length === 0 ? <p className={styles.panelHint}>No matching clinic patient found.</p> : null}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>No match?</p><h2>Create a lightweight record</h2></div></div>
        <form className={styles.walkInForm} onSubmit={createAndAdd}>
          <label className={styles.formField}><span>Full name</span><input required value={fullName} onChange={(event) => { setFullName(event.target.value); setCandidates([]); setDistinctConfirmed(false); }} /></label>
          <label className={styles.formField}><span>Phone</span><input required type="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setCandidates([]); setDistinctConfirmed(false); }} /></label>
          {candidates.length > 0 && !distinctConfirmed ? (
            <div className={styles.duplicateReview} role="alert">
              <strong>Possible existing patient</strong>
              <p>Use the matching record, or confirm this is a different person.</p>
              <ul>{candidates.map((candidate) => <li key={candidate.id}><div><strong>{candidate.fullName}</strong><span>{candidate.phone}</span></div><button type="button" className={styles.secondaryButton} onClick={() => void addWalkIn(candidate.id)}>Use existing patient</button></li>)}</ul>
              <button type="button" className={styles.secondaryButton} onClick={() => setDistinctConfirmed(true)}>Different patient</button>
            </div>
          ) : null}
          <button className={styles.primaryButton} disabled={busy || (candidates.length > 0 && !distinctConfirmed)}>{busy ? "Adding…" : "Add as walk-in"}</button>
        </form>
      </section>
    </div>
  );
}
