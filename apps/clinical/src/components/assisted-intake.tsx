"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistedIntakeContext } from "@/lib/db/patient-intake";
import styles from "@/components/clinical.module.css";

function lines(value: string): string[] { return value.split("\n").map((item) => item.trim()).filter(Boolean); }
function list(values: string[]): string { return values.length ? values.join(", ") : "None reported"; }
function enteredBy(statement: AssistedIntakeContext["statements"][number]): string {
  return statement.enteredVia === "patient_web" ? "Entered by patient" : `Entered by ${statement.enteredByName ?? "Clinic Desk staff"} on behalf of patient`;
}

export function AssistedIntake({ appointmentId, initialStatus, initialContext }: { appointmentId: string; initialStatus: string; initialContext: AssistedIntakeContext | null }) {
  const router = useRouter();
  const [context, setContext] = useState<AssistedIntakeContext | null>(initialContext);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [consent, setConsent] = useState(false);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/appointments/${appointmentId}/assisted-intake`);
    const payload = await response.json().catch(() => null) as { context?: AssistedIntakeContext; error?: string } | null;
    if (!response.ok) setError(payload?.error ?? "Could not load intake history");
    else setContext(payload?.context ?? null);
    setLoading(false);
  }
  async function submit() {
    setBusy(true); setError(null);
    const response = await fetch(`/api/appointments/${appointmentId}/assisted-intake`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consentAccepted: consent, consentVersion: "preconsult-intake-consent/v1.0",
        reasonForVisitRaw: reason, conditions: lines(conditions), medications: lines(medications), allergies: lines(allergies) }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) setError(payload?.error ?? "Could not save patient details");
    else { setReason(""); setConditions(""); setMedications(""); setAllergies(""); setConsent(false); await load(); router.refresh(); }
    setBusy(false);
  }

  const isCorrection = context?.intakeStatus === "submitted" || initialStatus === "submitted";
  return (
    <section className={`${styles.panel} ${styles.assistedIntakePanel}`}>
      <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Patient-reported · unconfirmed</p><h2>Help patient complete intake</h2></div><span className={styles.panelHint}>{isCorrection ? "Add clarification" : "Assisted completion"}</span></div>
      <p className={styles.assistedNotice}>Record what the patient tells you. This will show the patient as the information source and you as the data-entry person. It is not doctor-confirmed.</p>
      {loading ? <p>Loading intake history…</p> : null}
      {context?.statements.map((statement) => (
        <article className={styles.intakeStatement} key={statement.id}>
          <div><strong>{statement.kind === "original" ? "Original patient statement" : "Added clarification"}</strong><span>{enteredBy(statement)} · {new Date(statement.createdAt).toLocaleString("en-IN")}</span></div>
          <p>{statement.reasonForVisitRaw}</p>
          <dl><div><dt>Conditions</dt><dd>{list(statement.conditions)}</dd></div><div><dt>Medicines</dt><dd>{list(statement.medications)}</dd></div><div><dt>Allergies</dt><dd>{list(statement.allergies)}</dd></div></dl>
        </article>
      ))}
      <div className={styles.assistedForm}>
        <label>{isCorrection ? "Correction or clarification" : "Reason for visit"}<textarea maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
        <label>Conditions (one per line)<textarea value={conditions} onChange={(e) => setConditions(e.target.value)} /></label>
        <label>Medicines (one per line)<textarea value={medications} onChange={(e) => setMedications(e.target.value)} /></label>
        <label>Allergies (one per line)<textarea value={allergies} onChange={(e) => setAllergies(e.target.value)} /></label>
        <label className={styles.consentCheck}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> The patient has agreed to intake processing and document storage, and asked me to enter this information.</label>
        {isCorrection ? <p className={styles.panelHint}>This adds a new traceable clarification. The original statement will not be changed.</p> : null}
        {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
        <button className={styles.primaryButton} disabled={busy || !consent || reason.trim().length === 0} onClick={() => void submit()}>{busy ? "Saving…" : isCorrection ? "Add clarification" : "Complete with patient"}</button>
      </div>
    </section>
  );
}
