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
  manual_review: 4,
  recording: 2,
  recording_interrupted: 2,
  processing: 3,
  review: 4,
  approved: 5,
  rejected: 5,
  failed: 3,
};

const blankManualDraft = Object.fromEntries(aiDraftFields.map((field) => [field.id, ""]));
const waveformBars = [10, 18, 26, 16, 22, 30, 20, 14, 24, 28, 18, 12];

function SafetyLabel({ mode }: { mode: "ai" | "manual" }) {
  return (
    <div className={styles.safetyLabel} role="note">
      {mode === "ai" ? (
        <>
          <strong>AI-generated draft. Doctor review and approval required before use.</strong>
          <span>The AI does not diagnose, prescribe, or replace clinical judgment.</span>
        </>
      ) : (
        <>
          <strong>Doctor-written note. Recording was declined, so no audio or transcript was created.</strong>
          <span>Only doctor-entered and approved content can be added to clinical memory.</span>
        </>
      )}
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

function RecordingWaveform({ paused }: { paused: boolean }) {
  return (
    <div
      className={`${styles.recordingRail} ${paused ? styles.pausedRail : ""}`}
      role="status"
      aria-label={paused
        ? "Recording paused at 46 seconds. Audio capture is paused and consent is protected."
        : "Recording active for 46 seconds. Audio input is clear and consent is protected."}
    >
      <div className={styles.recordingRailStatus}>
        <span aria-hidden="true" />
        <div>
          <strong>{paused ? "Paused · 00:46" : "Recording · 00:46"}</strong>
          <small>{paused ? "Audio capture is paused" : "Continue the consultation normally"}</small>
        </div>
      </div>
      <div className={styles.miniWaveform} aria-hidden="true">
        {waveformBars.map((height, index) => (
          <span
            className={styles.waveBar}
            key={`wave-${index}`}
            style={{
              animationDelay: `${(index % 6) * -220}ms`,
              animationDuration: `${1800 + (index % 4) * 220}ms`,
              height: `${height}px`,
            }}
          />
        ))}
      </div>
      <div className={styles.recordingRailMeta}>
        <strong><i aria-hidden="true" /> {paused ? "Audio paused" : "Audio clear"}</strong>
        <small>{paused ? "Resume when ready" : "Transcript syncing"} · Consent protected</small>
      </div>
    </div>
  );
}

function Icon({ name }: { name: "home" | "users" | "note" | "memory" | "sparkle" | "chevron" | "reset" }) {
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    memory: <><path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4"/><circle cx="12" cy="12" r="4"/></>,
    sparkle: <><path d="m12 3-1.2 3.3L7.5 7.5l3.3 1.2L12 12l1.2-3.3 3.3-1.2-3.3-1.2Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8ZM19 14l-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></>,
  };

  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function PrototypePage() {
  const [state, setState] = useState<WorkflowState>("patient");
  const [draftFields, setDraftFields] = useState(() =>
    Object.fromEntries(aiDraftFields.map((field) => [field.id, field.value])),
  );
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const step = activeStep[state];
  const isManualReview = state === "manual_review";

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
    setIsRecordingPaused(false);
    setDraftFields(Object.fromEntries(aiDraftFields.map((field) => [field.id, field.value])));
  }

  function startManualReview() {
    setDraftFields(blankManualDraft);
    setReviewConfirmed(false);
    setState("manual_review");
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand}>
          <span aria-hidden="true"><Icon name="sparkle" /></span>
          <div><strong>Smaran</strong><small>Clinical memory</small></div>
        </Link>

        <div className={styles.clinicSwitcher}>
          <span>MS</span>
          <div><small>Workspace</small><strong>Meera&apos;s Clinic</strong></div>
          <Icon name="chevron" />
        </div>

        <nav className={styles.sideNav} aria-label="Prototype navigation">
          <p>Workspace</p>
          <button type="button"><Icon name="home" /><span>Overview</span></button>
          <button type="button" className={styles.activeNav}><Icon name="users" /><span>Patients</span><small>24</small></button>
          <button type="button"><Icon name="note" /><span>Consultations</span><small>8</small></button>
          <button type="button"><Icon name="memory" /><span>Memory</span></button>
        </nav>

        <div className={styles.sidebarPatient}>
          <div className={styles.avatar}>AS</div>
          <div><small>Current patient</small><strong>{syntheticPatient.name}</strong><span>{syntheticPatient.id}</span></div>
        </div>

        <div className={styles.doctorCard}>
          <div className={styles.doctorAvatar}>MS</div>
          <div><strong>Dr Meera Shah</strong><small>Endocrinology</small></div>
          <span>•••</span>
        </div>
      </aside>

      <div className={styles.appSurface}>
        <header className={styles.floatingHeader}>
          <div className={styles.headerPatient}>
            <span className={styles.mobileMark}><Icon name="sparkle" /></span>
            <div>
              <small>Follow-up consultation</small>
              <strong>{syntheticPatient.name}</strong>
            </div>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.demoBadge}><i /> Synthetic data only</span>
            <button type="button" className={styles.resetButton} onClick={reset}><Icon name="reset" /> Reset</button>
          </div>
        </header>

        <section className={styles.workflowCard}>
          <div className={styles.workflowIntro}>
            <div>
              <span>Safe workflow</span>
              <strong>{workflowStates[step].label}</strong>
            </div>
            <small>Step {step + 1} of 6</small>
          </div>
          <nav className={styles.stepper} aria-label="Prototype workflow progress">
            {workflowStates.slice(0, 6).map((item, index) => (
              <div
                className={`${styles.step} ${index === step ? styles.activeStep : ""} ${index < step ? styles.completeStep : ""}`}
                key={item.id}
              >
                <span>{index < step ? "✓" : index + 1}</span>
                <div><strong>{item.label}</strong><small>{item.safetyRule}</small></div>
              </div>
            ))}
          </nav>
        </section>

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
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!consentConfirmed}
                onClick={() => { setIsRecordingPaused(false); setState("recording"); }}
              >
                Begin recording
              </button>
            </div>
          </div>
        )}

        {state === "consent_declined" && (
          <div className={styles.outcomePanel}>
            <span className={styles.neutralIcon} aria-hidden="true">—</span>
            <p className={styles.eyebrow}>Recording declined</p>
            <h2>Record the visit manually</h2>
            <p>No audio, transcript, or AI draft was created. The doctor can return to the profile or write a manual consultation note for review and approval.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>Return to patient profile</button>
              <button type="button" className={styles.primaryButton} onClick={startManualReview}>Write manual note</button>
            </div>
          </div>
        )}

        {state === "recording" && (
          <div className={`${styles.focusPanel} ${styles.recordingPanel}`}>
            <h2>Consultation in progress</h2>
            <RecordingWaveform paused={isRecordingPaused} />
            <details className={styles.transcriptPreview}>
              <summary>
                <span>View live transcript</span>
                <small>3 recent lines</small>
              </summary>
              <div>
                {syntheticTranscript.slice(0, 3).map((line) => <p key={line}>{line}</p>)}
              </div>
            </details>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("recording_interrupted")}>Cancel recording</button>
              <button
                type="button"
                className={styles.secondaryButton}
                aria-pressed={isRecordingPaused}
                onClick={() => setIsRecordingPaused((paused) => !paused)}
              >
                {isRecordingPaused ? "Resume recording" : "Pause recording"}
              </button>
              <button type="button" className={styles.stopButton} onClick={() => setState("processing")}>Stop and process</button>
            </div>
            <p className={styles.recordingConsentNote}>Consent recorded for audio and clinical processing · Patient sharing not granted</p>
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
              <button type="button" className={styles.primaryButton} onClick={() => { setConsentConfirmed(false); setIsRecordingPaused(false); setState("consent"); }}>Confirm consent again</button>
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

        {(state === "review" || state === "manual_review") && (
          <>
            <SafetyLabel mode={isManualReview ? "manual" : "ai"} />
            <div className={styles.screenHeading}>
              <div>
                <p className={styles.eyebrow}>Unapproved clinical note</p>
                <h2>{isManualReview ? "Write consultation note" : "Review every field"}</h2>
              </div>
              <span className={styles.draftBadge}>{isManualReview ? "Manual note" : "AI draft"}</span>
            </div>
            <div className={styles.fieldList}>
              {aiDraftFields.map((field) => (
                <section className={field.id === "uncertainItems" ? styles.uncertainField : styles.draftField} key={field.id}>
                  <div className={styles.fieldHeading}>
                    <label htmlFor={`draft-${field.id}`}>{field.label}</label>
                    {isManualReview ? (
                      <span className={styles.manualBadge}>Doctor entry</span>
                    ) : (
                      <span className={`${styles.confidence} ${styles[field.confidence]}`}>{field.confidence} confidence</span>
                    )}
                  </div>
                  <textarea
                    id={`draft-${field.id}`}
                    value={draftFields[field.id]}
                    onChange={(event) => updateDraftField(field.id, event.target.value)}
                    placeholder={isManualReview ? "Write only what the doctor wants added to the consultation record." : undefined}
                    rows={field.id === "summary" ? 5 : 3}
                  />
                  {field.requiresVerification && <p className={styles.verifyFlag}>{isManualReview ? "Doctor-authored field" : "Doctor verification required"}</p>}
                  {isManualReview ? (
                    <p className={styles.manualEvidence}>No recording evidence is attached because the patient declined recording.</p>
                  ) : (
                    <details className={styles.evidence}>
                      <summary>View supporting evidence</summary>
                      {field.evidence.map((line) => <p key={line}>{line}</p>)}
                    </details>
                  )}
                </section>
              ))}
            </div>
            <label className={styles.reviewCheck}>
              <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
              <span>{isManualReview ? "I wrote and reviewed this consultation note, and approve it for clinical memory." : "I reviewed every field, supporting evidence, and uncertainty in this draft."}</span>
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
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>View updated patient profile</button>
              <button type="button" className={styles.primaryButton} onClick={reset}>Go to next patient</button>
            </div>
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
            <p>No AI draft was created and nothing was added to the patient timeline. Retry processing, return to the profile, or let the doctor write the note manually.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>Return to profile</button>
              <button type="button" className={styles.secondaryButton} onClick={startManualReview}>Write manual note</button>
              <button type="button" className={styles.primaryButton} onClick={() => setState("processing")}>Retry safely</button>
            </div>
          </div>
        )}
        </section>

        <footer className={styles.footer}>
          <span><i /> Synthetic prototype</span>
          Workflow content must be tested with doctors before becoming a product requirement.
        </footer>
      </div>
    </main>
  );
}
