"use client";

import { FormEvent, useEffect, useState } from "react";
import type { PatientIntakeContext } from "@/lib/db/patient-intake";
import { DocumentManager } from "@/components/document-manager";
import styles from "@/components/clinical.module.css";

type IntakeStep = "loading" | "error" | "form" | "submitted";

function appointmentLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "your upcoming appointment";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function lines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export function PatientIntakeForm({ token }: { token: string }) {
  const endpoint = `/api/intake/${encodeURIComponent(token)}`;
  const [step, setStep] = useState<IntakeStep>("loading");
  const [context, setContext] = useState<PatientIntakeContext | null>(null);
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [reason, setReason] = useState("");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyContext(next: PatientIntakeContext) {
    setContext(next);
    setFullName(next.patientFullName);
    setDateOfBirth(next.patientDateOfBirth ?? "");
    setGender(next.patientGender ?? "");
    setReason(next.reasonForVisitRaw ?? "");
    setConditions(next.selfReportedConditions.join("\n"));
    setMedications(next.selfReportedMedications.join("\n"));
    setAllergies(next.selfReportedAllergies.join("\n"));
    setStep(next.intakeStatus === "submitted" ? "submitted" : "form");
  }

  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setError(await responseMessage(response, "This intake link is invalid or expired."));
          setStep("error");
          return;
        }
        const body = await response.json() as { context: PatientIntakeContext };
        applyContext(body.context);
      })
      .catch(() => {
        if (active) {
          setError("We could not open the intake form. Please try again.");
          setStep("error");
        }
      });
    return () => { active = false; };
  }, [endpoint]);

  async function submitIntake(event: FormEvent) {
    event.preventDefault();
    if (!context) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consentAccepted,
          consentVersion: context.consentVersion,
          reasonForVisitRaw: reason,
          conditions: lines(conditions),
          medications: lines(medications),
          allergies: lines(allergies),
          fullName,
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(gender ? { gender } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The intake could not be submitted."));
      setStep("submitted");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The intake could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.intakePage}>
      <section className={styles.intakeCard} aria-live="polite">
        <div className={styles.intakeBrand}>
          <span aria-hidden="true">S</span>
          <div>
            <strong>Smaran Health</strong>
            <small>Secure patient intake</small>
          </div>
        </div>

        {step === "loading" ? (
          <div className={styles.intakeState}>
            <div className={styles.intakeSpinner} aria-hidden="true" />
            <h1>Opening your secure form…</h1>
            <p>Please keep this page open.</p>
          </div>
        ) : null}

        {step === "error" ? (
          <div className={styles.intakeState} role="alert">
            <h1>This intake link can&apos;t be opened</h1>
            <p>{error || "Please ask the clinic to send a new intake link."}</p>
            <p className={styles.intakePrivacyNote}>This link only opens this appointment&apos;s intake form.</p>
          </div>
        ) : null}

        {step === "form" && context ? (
          <form className={styles.intakeForm} onSubmit={submitIntake}>
            <header className={styles.intakeHeader}>
              <p className={styles.eyebrow}>{context.clinicName}</p>
              <h1>Help your doctor prepare</h1>
              <p>{appointmentLabel(context.scheduledAt)} · mobile {context.maskedPhone}</p>
              <div className={styles.intakeNonBlocking}>Optional details can help, but this form never blocks your consultation.</div>
              <ol className={styles.intakeProgress} aria-label="Intake progress">
                <li>Details</li><li>Visit</li><li>Optional health details</li><li>Documents</li><li>Review</li>
              </ol>
            </header>

            <fieldset className={styles.intakeFieldset}>
              <legend>Check your details</legend>
              <p>You may correct these details. The clinic keeps an audit trail of changes.</p>
              <label className={styles.intakeField}>
                <span>Full name</span>
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={200} required />
              </label>
              <div className={styles.intakeFieldGrid}>
                <label className={styles.intakeField}>
                  <span>Date of birth</span>
                  <input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
                </label>
                <label className={styles.intakeField}>
                  <span>Gender</span>
                  <input value={gender} onChange={(event) => setGender(event.target.value)} maxLength={50} placeholder="Optional" />
                </label>
              </div>
              <p className={styles.intakeLockedField}>Your registered mobile number cannot be changed from this form.</p>
            </fieldset>

            <fieldset className={styles.intakeFieldset}>
              <legend>Why are you visiting?</legend>
              <p>Please use your own words. Your text is kept as entered for the doctor.</p>
              <label className={styles.intakeField}>
                <span>Reason for visit <b>Required</b></span>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={5} maxLength={2000} required />
                <small>{reason.length}/2000</small>
              </label>
            </fieldset>

            <fieldset className={styles.intakeFieldset}>
              <legend>Optional medical details</legend>
              <p>Enter one item per line. These are patient-reported and remain unconfirmed until a doctor reviews them.</p>
              <label className={styles.intakeField}>
                <span>Existing conditions</span>
                <textarea value={conditions} onChange={(event) => setConditions(event.target.value)} rows={3} maxLength={4000} placeholder="For example, one condition per line" />
              </label>
              <label className={styles.intakeField}>
                <span>Current medicines</span>
                <textarea value={medications} onChange={(event) => setMedications(event.target.value)} rows={3} maxLength={4000} placeholder="Only include details you know" />
              </label>
              <label className={styles.intakeField}>
                <span>Allergies</span>
                <textarea value={allergies} onChange={(event) => setAllergies(event.target.value)} rows={3} maxLength={4000} placeholder="Medicine, food, or other allergies" />
              </label>
            </fieldset>

            <fieldset className={styles.intakeFieldset}>
              <legend>Documents <small>Optional</small></legend>
              <p>Add reports, prescriptions, or photos now if you have them. You can continue without documents.</p>
              <DocumentManager mode="patient" token={token} />
            </fieldset>

            <label className={styles.intakeConsent}>
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.target.checked)}
                required
              />
              <span>
                I consent to {context.clinicName} and Smaran Health securely processing and storing the information I submit for this appointment, including medical details and documents I choose to provide. This supports doctor preparation and does not replace medical advice. I can continue my consultation without completing this form.
                <small>Consent version {context.consentVersion}</small>
              </span>
            </label>

            {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
            <button className={styles.intakePrimaryButton} type="submit" disabled={pending || !consentAccepted || !reason.trim()}>
              {pending ? "Submitting securely…" : "Submit details"}
            </button>
            <p className={styles.intakePrivacyNote}>Your optional medical details are shared as unconfirmed patient-reported information. Your doctor remains in control.</p>
          </form>
        ) : null}

        {step === "submitted" ? (
          <div className={styles.intakeSubmittedContent}>
            <div className={styles.intakeState}>
              <span className={styles.intakeSuccessMark} aria-hidden="true">✓</span>
              <p className={styles.eyebrow}>Submitted securely</p>
              <h1>Thank you</h1>
              <p>Your intake has been shared with the clinic for this appointment.</p>
              <div className={styles.intakeNonBlocking}>Documents are optional and never block your consultation.</div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
