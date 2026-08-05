import type { CSSProperties } from "react";
import { MotionSystem } from "./motion-system";

const workflow = [
  {
    title: "Record without interrupting",
    text: "A doctor starts the consultation and the room microphone quietly captures the visit.",
  },
  {
    title: "Structure the conversation",
    text: "Smaran extracts complaints, findings, medicines, investigations, advice, and follow-up plans.",
  },
  {
    title: "Approve the note",
    text: "The doctor reviews, edits, and approves the clinical document before anything is stored or shared.",
  },
  {
    title: "Remember the next visit",
    text: "Before follow-up, the patient story returns as a clear timeline instead of disconnected notes.",
  },
];

const specialties = [
  "Diabetes",
  "Cardiology",
  "Rheumatology",
  "Orthopedics",
  "Dentistry",
  "ENT",
];

const languageMoments = [
  "Hindi + English",
  "Tamil + English",
  "Marathi + Hindi",
  "Kannada + English",
  "Bengali + Hindi",
  "Telugu + English",
];

const primaryMemoryLoop = [
  "Patient timeline",
  "Doctor-approved notes",
  "Mixed-language consults",
  "Follow-up briefs",
  "Medicine changes",
  "Doctor's Dashboard",
  "Morning briefing",
  "Doctor notes",
];

const secondaryMemoryLoop = [
  "Symptoms over time",
  "Investigations pending",
  "Lifestyle advice",
  "Specialty templates",
  "Clinic-ready sharing",
  "Daily consultation summary",
  "Pending follow-ups",
  "Clinical story",
];

const impactStats = [
  {
    value: "10+",
    text: "Indian languages understood - mixed freely, mid-sentence",
    accent: "mint",
  },
  {
    value: "30 sec",
    text: "to recall a patient's full history before a follow-up",
    accent: "blue",
  },
  {
    value: "100%",
    text: "of notes reviewed and approved by the doctor - always",
    accent: "coral",
  },
];

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span className="logo-core" />
      <span className="logo-path logo-path-a" />
      <span className="logo-path logo-path-b" />
      <span className="logo-dot logo-dot-a" />
      <span className="logo-dot logo-dot-b" />
      <span className="logo-dot logo-dot-c" />
    </span>
  );
}

function Waveform({ count = 30 }: { count?: number }) {
  return (
    <div className="waveform" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

function RecordingCard() {
  const rows = [
    ["Chief complaint", "Seene mein jalan, 2 hafte se"],
    ["Examination", "BP 138/88 - epigastric tenderness"],
    ["Medication", "Tab Pantoprazole 40 - subah khali pet"],
    ["Advice", "Chai/coffee kam; dinner 8 baje se pehle"],
    ["Follow-up", "2 weeks - endoscopy if no relief"],
  ];

  return (
    <div className="recording-card" aria-label="Live recording note preview">
      <div className="recording-header">
        <div className="recording-status">
          <span className="recording-dot" />
          <strong>Recording - OPD Room 2</strong>
        </div>
        <span className="language-pill">हि + EN</span>
      </div>
      <div className="recording-wave" aria-hidden="true">
        {Array.from({ length: 22 }).map((_, index) => (
          <span key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </div>
      <div className="recording-divider" />
      <p className="recording-kicker">Smaran is writing your note</p>
      <div className="recording-fields">
        {rows.map(([label, value]) => (
          <div className="recording-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="recording-ready">
        <span aria-hidden="true">✓</span>
        <strong>Note ready for your review</strong>
        <button type="button">Approve</button>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <MotionSystem />
      <section className="hero-shell">
        <div className="hero-background" aria-hidden="true">
          <div className="memory-orbit orbit-one" />
          <div className="memory-orbit orbit-two" />
          <Waveform />
          <RecordingCard />
        </div>

        <nav className="nav-bar" aria-label="Main navigation">
          <a className="brand" href="#top" aria-label="Smaran AI home">
            <LogoMark />
            <span>Smaran AI</span>
          </a>
          <div className="nav-links">
            <a href="#memory">Memory</a>
            <a href="#workflow">Workflow</a>
            <a href="#waitlist">Waitlist</a>
          </div>
        </nav>

        <div className="hero-content" id="top">
          <p className="eyebrow">AI clinical memory platform for INDIAN DOCTORS</p>
          <h1>Doctors should remember patients, not paperwork.</h1>
          <p className="hero-copy">
            Smaran AI listens every consultations, turns every visit into
            structured clinical memory, and remembers every patient&apos;s story -
            so no follow-up ever starts from zero.
          </p>
          <div className="hero-actions">
            <a href="#waitlist" className="primary-action">
              Join the doctor waitlist
            </a>
            <a href="#workflow" className="secondary-action">
              See how it works
            </a>
          </div>
        </div>
      </section>

      <section className="stats-section" id="impact" aria-labelledby="stats-title">
        <div className="stats-copy">
          <strong>70%</strong>
          <h2 id="stats-title">of documentation time, gone.</h2>
          <p>
            The more Smaran remembers, the less you write - and the more every
            consultation is just you and the patient.
          </p>
        </div>
        <div className="stats-grid">
          {impactStats.map((stat) => (
            <article className={`stat-card stat-card-${stat.accent}`} key={stat.value}>
              <strong>{stat.value}</strong>
              <p>{stat.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="memory-strip">
        <div className="marquee-row" aria-hidden="true">
          <div className="marquee-track">
            {Array.from({ length: 4 }).flatMap((_, group) =>
              primaryMemoryLoop.map((item) => (
                <span key={`${item}-${group}`}>{item}</span>
              )),
            )}
          </div>
        </div>
        <div className="memory-copy" data-reveal>
          <p>No generic transcription. No diagnosis engine. No extra clinic admin.</p>
          <p>Just a living clinical story, approved by the doctor every time.</p>
        </div>
        <div className="marquee-row reverse" aria-hidden="true">
          <div className="marquee-track">
            {Array.from({ length: 4 }).flatMap((_, group) =>
              secondaryMemoryLoop.map((item) => (
                <span key={`${item}-${group}`}>{item}</span>
              )),
            )}
          </div>
        </div>
      </section>

      <section className="product-section" id="memory">
        <div className="section-heading sticky-heading" data-reveal>
          <p className="eyebrow">The memory layer</p>
          <h2>Every consultation becomes the next consultation&apos;s context.</h2>
        </div>
        <div className="product-scenes">
          <article className="product-panel consult-panel" data-reveal>
            <div className="panel-topline">
              <span>Live consultation</span>
              <strong>Recording</strong>
            </div>
            <Waveform count={22} />
            <div className="transcript-stack">
              <p>Doctor: Continue metformin, review sugar logs after 2 weeks.</p>
              <p>Patient: Night cravings are better, walking 30 minutes daily.</p>
              <p>AI memory: Lifestyle response improved since last visit.</p>
            </div>
          </article>

          <article className="product-panel followup-panel" data-reveal>
            <div className="panel-topline">
              <span>Before follow-up</span>
              <strong>Prepared brief</strong>
            </div>
            <div className="patient-brief">
              <div>
                <span className="mini-label">Last visit</span>
                <strong>Medication changed after gastritis symptoms</strong>
              </div>
              <div>
                <span className="mini-label">Open loop</span>
                <strong>Fasting sugar report requested but not uploaded</strong>
              </div>
              <div>
                <span className="mini-label">Doctor note</span>
                <strong>Ask about adherence before changing dose</strong>
              </div>
            </div>
            <a className="panel-link" href="/memory">
              Open synthetic memory demo <span aria-hidden="true">→</span>
            </a>
          </article>

          <article className="product-panel timeline-panel" data-reveal>
            <div className="panel-topline">
              <span>Patient timeline</span>
              <strong>3 visits</strong>
            </div>
            <ol className="visit-timeline">
              <li>
                <span>Visit 01</span>
                <strong>Initial complaint captured in Hinglish</strong>
              </li>
              <li>
                <span>Visit 02</span>
                <strong>Medicine changed, test requested</strong>
              </li>
              <li>
                <span>Visit 03</span>
                <strong>Symptom trend improved, follow-up in 30 days</strong>
              </li>
            </ol>
          </article>
        </div>
      </section>

      <section
        className="workflow-section workflow-orbit-section"
        id="workflow"
        data-workflow-orbit
      >
        <div className="workflow-orbit-stage">
          <div className="section-heading workflow-heading" data-reveal>
            <p className="eyebrow">Clinic workflow</p>
          </div>

          <div className="workflow-center" data-reveal>
            <div className="workflow-center-state workflow-center-primary">
              <h2>Built around the way busy Indian clinics actually move.</h2>
            </div>
            <div className="workflow-center-state workflow-center-secondary">
              <h2>Four quiet steps turn a visit into memory.</h2>
              <p>
                From room conversation to doctor-approved clinical context,
                without slowing the consultation.
              </p>
            </div>
          </div>

          <div className="workflow-orbit" aria-label="Clinic workflow steps">
            <div className="workflow-orbit-ring" aria-hidden="true" />
            {workflow.map((item, index) => (
              <article
                className="workflow-card orbit-card"
                data-orbit-card
                key={item.title}
                style={{ "--index": index } as CSSProperties}
              >
                <span className="workflow-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="india-section">
        <div className="india-layout">
          <div className="section-heading india-heading">
            <p className="eyebrow">India-first intelligence</p>
            <h2>It understands how your clinic actually talks</h2>
            <p>
              Real consultations switch languages mid-sentence. Smaran is
              trained on Indian medical vocabulary, Indian drug brand names and
              mixed-language speech - and shares summaries where your patients
              already are: WhatsApp.
            </p>
          </div>

          <article className="clinic-example">
            <div className="example-label microphone-label">
              <span aria-hidden="true">|</span>
              <strong>Heard in the room</strong>
            </div>
            <blockquote>
              &quot;Sugar fasting mein 140 aa raha hai... walking thoda
              badhaiye aur raat ko chawal kam kar dijiye.&quot;
            </blockquote>
            <div className="example-label capture-label">
              <span aria-hidden="true">↓</span>
              <strong>Captured in the note</strong>
            </div>
            <div className="captured-note">
              <div>
                <span>Investigation</span>
                <strong>FBS 140 mg/dL - above target</strong>
              </div>
              <div>
                <span>Lifestyle advice</span>
                <strong>Increase daily walking; smaller rice portion at dinner</strong>
              </div>
            </div>
            <div className="whatsapp-line">
              <span aria-hidden="true">○</span>
              <strong>
                Patient summary shared on WhatsApp - in the patient&apos;s language
              </strong>
            </div>
          </article>
        </div>
        <div className="motion-lanes">
          <div className="lane">
            <div className="lane-track">
              {[...languageMoments, ...languageMoments].map((item, index) => (
                <span key={`${item}-${index}`}>{item}</span>
              ))}
            </div>
          </div>
          <div className="lane reverse">
            <div className="lane-track">
              {[...specialties, ...specialties].map((item, index) => (
                <span key={`${item}-${index}`}>{item}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="control-section">
        <div className="control-copy" data-reveal>
          <p className="eyebrow">Doctor control</p>
          <h2>The AI organizes information. It does not replace judgment.</h2>
          <p>
            Smaran never diagnoses, never modifies prescriptions, and never
            publishes a clinical document without doctor approval.
          </p>
        </div>
        <div className="control-grid">
          {[
            "No independent diagnosis",
            "No prescription changes",
            "No hallucinated medical facts",
            "No patient summary without approval",
          ].map((item) => (
            <div className="control-item" data-reveal key={item}>
              <span />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="faq-section">
        <div className="section-heading" data-reveal>
          <p className="eyebrow">Founder notes translated into product</p>
          <h2>Sharp positioning for the first version.</h2>
        </div>
        <div className="faq-list">
          <details open data-reveal>
            <summary>Is Smaran just an AI transcription app?</summary>
            <p>
              No. Transcription is one input. The product value is continuity:
              every approved consultation becomes searchable, structured
              clinical memory for the next visit.
            </p>
          </details>
          <details data-reveal>
            <summary>Who is the primary customer?</summary>
            <p>
              Specialist doctors, private clinics, and multi-specialty clinics.
              Patients benefit through clearer instructions, but the workflow is
              designed around doctors.
            </p>
          </details>
          <details data-reveal>
            <summary>What makes it India-first?</summary>
            <p>
              Mixed-language consultations, Indian drug names, busy clinic
              workflows, WhatsApp-ready sharing, and specialty templates shaped
              around local practice.
            </p>
          </details>
        </div>
      </section>

      <section className="cta-section" id="waitlist">
        <div className="cta-motion" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="cta-copy" data-reveal>
          <LogoMark />
          <h2>Build the clinical memory every doctor wishes they had.</h2>
          <p>
            Smaran AI is shaping its first doctor-led pilots for Indian clinics.
          </p>
          <a className="primary-action" href="mailto:hello@smaran.ai?subject=Smaran%20AI%20pilot">
            Request pilot access
          </a>
        </div>
      </section>

      <footer className="brand-footer" aria-label="Smaran AI footer">
        <div className="brand-footer-card">
          <LogoMark />
          <p>
            &copy; 2026 Smaran AI. All rights reserved.
            <br />
            Built for Indian clinics.
          </p>
        </div>
        <div className="brand-footer-glow" aria-hidden="true" />
        <strong className="brand-footer-word" aria-hidden="true">
          Smaran
        </strong>
      </footer>
    </main>
  );
}
