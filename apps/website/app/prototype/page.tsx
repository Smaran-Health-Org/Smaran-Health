"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  aiDraft,
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
  recording: 2,
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
  const [draftSummary, setDraftSummary] = useState(aiDraft.summary);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
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
              detail: draftSummary,
              source: "Approved in prototype · Doctor action",
              status: "approved" as const,
            },
            ...approvedTimeline,
          ]
        : approvedTimeline,
    [draftSummary, isApproved],
  );

  function reset() {
    setState("patient");
    setConsentConfirmed(false);
    setIsApproved(false);
    setDraftSummary(aiDraft.summary);
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
          <p className={styles.eyebrow}>Task 10 prototype</p>
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
              <button type="button" className={styles.primaryButton} disabled={!consentConfirmed} onClick={() => setState("recording")}>Begin recording</button>
            </div>
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
            <button type="button" className={styles.stopButton} onClick={() => setState("processing")}>Stop and process</button>
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
            <label className={styles.editorLabel}>
              Consultation summary
              <textarea value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} rows={6} />
            </label>
            <div className={styles.draftGrid}>
              <section><strong>Medication changes</strong><p>{aiDraft.medicationChanges}</p></section>
              <section><strong>Investigations</strong><p>{aiDraft.investigations}</p></section>
              <section className={styles.uncertain}><strong>Uncertain item</strong><p>{aiDraft.uncertainItems}</p></section>
            </div>
            <details className={styles.evidence}>
              <summary>View source transcript</summary>
              {syntheticTranscript.map((line) => <p key={line}>{line}</p>)}
            </details>
            <div className={styles.reviewActions}>
              <button type="button" className={styles.rejectButton} onClick={() => setState("rejected")}>Reject draft</button>
              <button
                type="button"
                className={styles.primaryButton}
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
            <div className={styles.outcomeEvent}><strong>Today · Current follow-up</strong><p>{draftSummary}</p><small>Approved in prototype · Doctor action</small></div>
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
