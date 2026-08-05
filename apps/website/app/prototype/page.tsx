"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  aiDraftFields,
  approvedTimeline,
  preVisitMemory,
  syntheticPatient,
  syntheticTranscript,
  workflowStates,
  type WorkflowState,
} from "./mock-data";
import styles from "./prototype.module.css";

const activeStep: Record<WorkflowState, number> = {
  patient: 0,
  consent: 1,
  consent_declined: 1,
  recording: 2,
  recording_interrupted: 2,
  processing: 3,
  review: 4,
  approved: 5,
  rejected: 5,
  failed: 3,
};

function SafetyLabel() {
  return (
    <div className={styles.safetyLabel} role="note">
      <strong>AI-generated draft. Doctor review and approval required before use.</strong>
      <span>The AI does not diagnose, prescribe, or replace clinical judgment.</span>
    </div>
  );
}

function MemoryColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <section className={styles.memoryColumn}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default function PrototypePage() {
  const [state, setState] = useState<WorkflowState>("patient");
  const [draftFields, setDraftFields] = useState(() =>
    Object.fromEntries(aiDraftFields.map((field) => [field.id, field.value])),
  );
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const step = activeStep[state];

  const timeline = useMemo(
    () =>
      isApproved
        ? [
            {
              id: "approved-prototype-current",
              date: "Today · Synthetic",
              title: "Current follow-up",
              detail: draftFields.summary,
              source: "Approved in prototype · Doctor action",
              status: "approved" as const,
            },
            ...approvedTimeline,
          ]
        : approvedTimeline,
    [draftFields.summary, isApproved],
  );

  const approvedMemory = isApproved
    ? {
        visit: draftFields.summary,
        medication: draftFields.medicationChanges,
        investigation: draftFields.investigations,
        uncertainty: draftFields.uncertainItems,
      }
    : null;

  function updateDraftField(id: keyof typeof draftFields, value: string) {
    setDraftFields((current) => ({ ...current, [id]: value }));
    setReviewConfirmed(false);
  }

  function reset() {
    setState("patient");
    setConsentConfirmed(false);
    setReviewConfirmed(false);
    setIsApproved(false);
    setDraftFields(Object.fromEntries(aiDraftFields.map((field) => [field.id, field.value])));
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <span aria-hidden="true">S</span>
          Smaran AI
        </Link>
        <div className={styles.demoBadge}>Synthetic workflow · no patient data</div>
      </header>

      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Task 14 · doctor workflow</p>
          <h1>One safe path from patient context to approved memory.</h1>
          <p>
            A clickable returning-patient scenario for doctor feedback. Every clinical detail is
            synthetic, and only the approval action can add the current visit to the timeline.
          </p>
        </div>
        <button type="button" className={styles.resetButton} onClick={reset}>
          Reset scenario
        </button>
      </section>

      <nav className={styles.stepper} aria-label="Prototype workflow progress">
        {workflowStates.slice(0, 6).map((item, index) => (
          <div
            className={`${styles.step} ${index === step ? styles.activeStep : ""} ${index < step ? styles.completeStep : ""}`}
            key={item.id}
          >
            <span>{index < step ? "✓" : index + 1}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.safetyRule}</small>
            </div>
          </div>
        ))}
      </nav>

      <section className={styles.workspace} aria-live="polite">
        {state === "patient" && (
          <>
            <div className={styles.screenHeading}>
              <div>
                <p className={styles.eyebrow}>Returning patient</p>
                <h2>{syntheticPatient.name}</h2>
                <p>
                  {syntheticPatient.age} years · {syntheticPatient.location} · {syntheticPatient.id}
                </p>
              </div>
              <div className={styles.patientChip}>Synthetic patient</div>
            </div>

            <div className={styles.contextCard}>
              <strong>Reason for today&apos;s follow-up</strong>
              <p>{syntheticPatient.followUpReason}</p>
            </div>

            {approvedMemory && (
              <section className={styles.approvedMemory} aria-label="Approved follow-up memory">
                <div>
                  <p className={styles.eyebrow}>Approved follow-up memory</p>
                  <h3>Context for the next visit</h3>
                </div>
                <dl>
                  <div><dt>Current visit</dt><dd>{approvedMemory.visit}</dd></div>
                  <div><dt>Medication record</dt><dd>{approvedMemory.medication}</dd></div>
                  <div><dt>Pending investigation</dt><dd>{approvedMemory.investigation}</dd></div>
                  <div><dt>Verify next time</dt><dd>{approvedMemory.uncertainty}</dd></div>
                </dl>
                <small>✓ Derived only from the doctor-approved synthetic note · Today</small>
              </section>
            )}

            <div className={styles.memoryGrid}>
              <MemoryColumn title="Medication record" items={preVisitMemory.medicationChanges} />
              <MemoryColumn title="Pending investigations" items={preVisitMemory.investigations} />
              <MemoryColumn title="Previous advice" items={preVisitMemory.priorAdvice} />
              <MemoryColumn title="Unresolved items" items={preVisitMemory.unresolvedItems} />
            </div>

            <div className={styles.timeline}>
              <div className={styles.sectionTitle}>
                <div><p className={styles.eyebrow}>Approved history only</p><h3>Patient timeline</h3></div>
                <span>Draft and rejected notes excluded</span>
              </div>
              {timeline.map((event) => (
                <article key={event.id}>
                  <time>{event.date}</time>
                  <div><strong>{event.title}</strong><p>{event.detail}</p><small>✓ {event.source}</small></div>
                </article>
              ))}
            </div>

            <button type="button" className={styles.primaryButton} onClick={() => setState("consent")}>
              Start consultation
            </button>
          </>
        )}

        {state === "consent" && (
          <div className={styles.focusPanel}>
            <p className={styles.eyebrow}>Consent checkpoint</p>
            <h2>Confirm before recording</h2>
            <p className={styles.lead}>
              Explain that Smaran records this consultation to prepare a draft clinical note for
              doctor review. Declining recording must not affect care.
            </p>
            <dl className={styles.consentDetails}>
              <div><dt>Notice</dt><dd>{syntheticPatient.consent.noticeVersion}</dd></div>
              <div><dt>Language</dt><dd>{syntheticPatient.consent.language}</dd></div>
              <div><dt>Method</dt><dd>{syntheticPatient.consent.method}</dd></div>
              <div><dt>Included</dt><dd>{syntheticPatient.consent.scopes.join(" · ")}</dd></div>
              <div><dt>Not included</dt><dd>{syntheticPatient.consent.excludedScopes.join(" · ")}</dd></div>
            </dl>
            <label className={styles.consentCheck}>
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
              />
              <span>I recorded the patient&apos;s explicit consent for the included scopes.</span>
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>Cancel</button>
              <button type="button" className={styles.declineButton} onClick={() => setState("consent_declined")}>Patient declined recording</button>
              <button type="button" className={styles.primaryButton} disabled={!consentConfirmed} onClick={() => setState("recording")}>Begin recording</button>
            </div>
          </div>
        )}

        {state === "consent_declined" && (
          <div className={styles.outcomePanel}>
            <span className={styles.neutralIcon} aria-hidden="true">—</span>
            <p className={styles.eyebrow}>Recording declined</p>
            <h2>Continue care without recording</h2>
            <p>No audio, transcript, draft, or clinical memory was created. Declining recording does not affect the patient&apos;s care.</p>
            <button type="button" className={styles.primaryButton} onClick={() => setState("patient")}>Return to patient profile</button>
          </div>
        )}

        {state === "recording" && (
          <div className={styles.focusPanel}>
            <div className={styles.recordingStatus}><span aria-hidden="true" />Recording · 00:46</div>
            <h2>Consultation in progress</h2>
            <p className={styles.lead}>Consent: granted for recording and clinical processing · patient sharing: not granted</p>
            <div className={styles.waveform} aria-hidden="true">
              {Array.from({ length: 28 }).map((_, index) => <span key={index} style={{ height: `${18 + (index % 7) * 7}px` }} />)}
            </div>
            <div className={styles.transcriptPreview}>
              {syntheticTranscript.slice(0, 3).map((line) => <p key={line}>{line}</p>)}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("recording_interrupted")}>Simulate interruption</button>
              <button type="button" className={styles.stopButton} onClick={() => setState("processing")}>Stop and process</button>
            </div>
          </div>
        )}

        {state === "recording_interrupted" && (
          <div className={styles.outcomePanel} role="alert">
            <span className={styles.failedIcon} aria-hidden="true">!</span>
            <p className={styles.eyebrow}>Recording interrupted</p>
            <h2>The recording stopped safely</h2>
            <p>No draft or memory was created. Restart only after confirming the patient still consents to recording.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>Return to profile</button>
              <button type="button" className={styles.primaryButton} onClick={() => { setConsentConfirmed(false); setState("consent"); }}>Confirm consent again</button>
            </div>
          </div>
        )}

        {state === "processing" && (
          <div className={styles.focusPanel}>
            <div className={styles.processingIcon} aria-hidden="true">•••</div>
            <p className={styles.eyebrow}>Processing synthetic audio</p>
            <h2>Preparing a draft for review</h2>
            <p className={styles.lead}>Transcript → structured extraction → draft note. Nothing is approved or added to memory yet.</p>
            <div className={styles.processingSteps}>
              <span>✓ Recording received</span><span>✓ Transcript prepared</span><span>• Validating draft structure</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("failed")}>Simulate failure</button>
              <button type="button" className={styles.primaryButton} onClick={() => setState("review")}>Open prepared draft</button>
            </div>
          </div>
        )}

        {state === "review" && (
          <>
            <SafetyLabel />
            <div className={styles.screenHeading}>
              <div><p className={styles.eyebrow}>Unapproved clinical note</p><h2>Review every field</h2></div>
              <span className={styles.draftBadge}>AI draft</span>
            </div>
            <div className={styles.fieldList}>
              {aiDraftFields.map((field) => (
                <section className={field.id === "uncertainItems" ? styles.uncertainField : styles.draftField} key={field.id}>
                  <div className={styles.fieldHeading}>
                    <label htmlFor={`draft-${field.id}`}>{field.label}</label>
                    <span className={`${styles.confidence} ${styles[field.confidence]}`}>{field.confidence} confidence</span>
                  </div>
                  <textarea
                    id={`draft-${field.id}`}
                    value={draftFields[field.id]}
                    onChange={(event) => updateDraftField(field.id, event.target.value)}
                    rows={field.id === "summary" ? 5 : 3}
                  />
                  {field.requiresVerification && <p className={styles.verifyFlag}>Doctor verification required</p>}
                  <details className={styles.evidence}>
                    <summary>View supporting evidence</summary>
                    {field.evidence.map((line) => <p key={line}>{line}</p>)}
                  </details>
                </section>
              ))}
            </div>
            <label className={styles.reviewCheck}>
              <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
              <span>I reviewed every field, supporting evidence, and uncertainty in this draft.</span>
            </label>
            <div className={styles.reviewActions}>
              <button type="button" className={styles.rejectButton} onClick={() => setState("rejected")}>Reject draft</button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!reviewConfirmed}
                onClick={() => {
                  setIsApproved(true);
                  setState("approved");
                }}
              >
                Approve note
              </button>
            </div>
          </>
        )}

        {state === "approved" && (
          <div className={styles.outcomePanel}>
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <p className={styles.eyebrow}>Doctor action recorded</p>
            <h2>Note approved and added to memory</h2>
            <p>The synthetic timeline now includes this visit. Approval is the only path that creates the new event.</p>
            <div className={styles.outcomeEvent}><strong>Today · Current follow-up</strong><p>{draftFields.summary}</p><small>Approved in prototype · Doctor action</small></div>
            <button type="button" className={styles.primaryButton} onClick={() => setState("patient")}>View updated patient profile</button>
          </div>
        )}

        {state === "rejected" && (
          <div className={styles.outcomePanel}>
            <span className={styles.rejectedIcon} aria-hidden="true">×</span>
            <p className={styles.eyebrow}>Draft rejected</p>
            <h2>No clinical memory was created</h2>
            <p>The rejected draft is excluded from the approved patient timeline. The doctor can return to the profile or start a new draft.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>Return to profile</button>
              <button type="button" className={styles.primaryButton} onClick={() => setState("processing")}>Create a new draft</button>
            </div>
          </div>
        )}

        {state === "failed" && (
          <div className={styles.outcomePanel} role="alert">
            <span className={styles.failedIcon} aria-hidden="true">!</span>
            <p className={styles.eyebrow}>Processing failed</p>
            <h2>We could not prepare the draft</h2>
            <p>No note was created and nothing was added to the patient timeline. Retry processing or return to the patient profile.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>Return to profile</button>
              <button type="button" className={styles.primaryButton} onClick={() => setState("processing")}>Retry safely</button>
            </div>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        Prototype assumption: workflow content is based on the founder blueprint and must be tested with doctors before becoming a product requirement.
      </footer>
    </main>
  );
}
