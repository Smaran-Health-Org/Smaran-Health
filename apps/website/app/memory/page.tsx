import type { Metadata } from "next";
import Link from "next/link";
import styles from "./memory.module.css";

export const metadata: Metadata = {
  title: "Follow-up Memory Demo | Smaran AI",
  description: "A synthetic doctor-facing prototype of Smaran AI's evidence-linked follow-up memory.",
};

type ApprovedSource = {
  id: string;
  date: string;
  doctor: string;
  status: "approved";
};

type MemoryItem = { text: string; sourceId: ApprovedSource["id"] };

const sources = [
  { id: "visit-18-jul", date: "18 July 2026", doctor: "Dr Meera Shah", status: "approved" },
  { id: "visit-20-jun", date: "20 June 2026", doctor: "Dr Meera Shah", status: "approved" },
  { id: "visit-22-may", date: "22 May 2026", doctor: "Dr Meera Shah", status: "approved" },
] satisfies ApprovedSource[];

const sourceById = new Map(sources.map((source) => [source.id, source]));

const memory = {
  lastVisit: "Night cravings were documented as improved. The doctor continued the recorded medicines and requested a fasting sugar log before review.",
  symptoms: [
    { text: "Night cravings improved since the previous visit", sourceId: "visit-18-jul" },
    { text: "No dizziness was reported during the visit", sourceId: "visit-18-jul" },
  ],
  medicationChanges: [
    { text: "Metformin was documented as continued without a recorded dose change", sourceId: "visit-18-jul" },
    { text: "The June note records that the evening dose timing was changed", sourceId: "visit-20-jun" },
  ],
  investigations: [
    { text: "Fasting sugar log requested for the next review", sourceId: "visit-18-jul" },
    { text: "HbA1c requested before the next scheduled visit", sourceId: "visit-18-jul" },
  ],
  unresolved: [
    { text: "Fasting sugar log was requested; no reviewed result appears in approved records", sourceId: "visit-18-jul" },
    { text: "Medication adherence was marked for review at the next visit", sourceId: "visit-18-jul" },
  ],
  lifestyle: [
    { text: "Continue the documented 30-minute daily walking routine", sourceId: "visit-18-jul" },
    { text: "Smaller rice portion at dinner was previously advised", sourceId: "visit-20-jun" },
  ],
  followUp: [
    { text: "Review in four weeks with the requested records", sourceId: "visit-18-jul" },
  ],
} satisfies Record<string, string | MemoryItem[]>;

function SourceTag({ sourceId }: { sourceId: string }) {
  const source = sourceById.get(sourceId);
  if (!source) return null;

  return (
    <span className={styles.sourceTag} title={`Approved by ${source.doctor}`}>
      Approved · {source.date}
    </span>
  );
}

function MemoryList({ items }: { items: MemoryItem[] }) {
  return (
    <ul className={styles.memoryList}>
      {items.map((item) => (
        <li key={`${item.sourceId}-${item.text}`}>
          <span className={styles.listMarker} aria-hidden="true" />
          <div><p>{item.text}</p><SourceTag sourceId={item.sourceId} /></div>
        </li>
      ))}
    </ul>
  );
}

const cards = [
  { eyebrow: "Since last visit", title: "Symptoms discussed", icon: "↗", tone: "mint", items: memory.symptoms },
  { eyebrow: "Approved record", title: "Medication changes", icon: "Rx", tone: "blue", items: memory.medicationChanges },
  { eyebrow: "Previously requested", title: "Investigations", icon: "▤", tone: "blue", items: memory.investigations },
  { eyebrow: "From approved records", title: "Unresolved items", icon: "!", tone: "coral", items: memory.unresolved, attention: true },
  { eyebrow: "Previously documented", title: "Lifestyle advice", icon: "◎", tone: "mint", items: memory.lifestyle },
  { eyebrow: "Recorded by doctor", title: "Follow-up plan", icon: "→", tone: "teal", items: memory.followUp },
] as const;

export default function MemoryDemo() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Back to Smaran AI home">
          <span className={styles.brandMark} aria-hidden="true">S</span><span>Smaran AI</span>
        </Link>
        <span className={styles.prototypeBadge}>Synthetic prototype</span>
      </header>

      <section className={styles.patientHeader} aria-labelledby="patient-name">
        <div className={styles.patientIdentity}>
          <span className={styles.avatar} aria-hidden="true">AS</span>
          <div>
            <p className={styles.kicker}>Before the consultation</p>
            <h1 id="patient-name">Ananya S. <span>· Synthetic patient</span></h1>
            <p>43 years · Patient ID DEMO-1042 · Last approved visit 18 July 2026</p>
          </div>
        </div>
        <div className={styles.approvalSummary}>
          <span aria-hidden="true">✓</span>
          <div><strong>Prepared from 3 approved notes</strong><p>Draft and rejected notes are excluded</p></div>
        </div>
      </section>

      <div className={styles.safetyBanner} role="note">
        <strong>Doctor review required.</strong>
        <span>This memory organizes approved records; it does not diagnose, prescribe, or replace clinical judgment.</span>
      </div>

      <section className={styles.overview} aria-labelledby="last-visit-title">
        <div>
          <p className={styles.kicker}>Last approved visit</p>
          <h2 id="last-visit-title">What changed last time</h2>
          <p className={styles.summary}>{memory.lastVisit}</p>
        </div>
        <SourceTag sourceId="visit-18-jul" />
      </section>

      <section className={styles.grid} aria-label="Follow-up memory details">
        {cards.map((card) => (
          <article className={`${styles.card} ${card.attention ? styles.attentionCard : ""}`} key={card.title}>
            <div className={styles.cardHeading}>
              <span className={`${styles.icon} ${styles[card.tone]}`} aria-hidden="true">{card.icon}</span>
              <div><p>{card.eyebrow}</p><h2>{card.title}</h2></div>
            </div>
            <MemoryList items={card.items} />
          </article>
        ))}
      </section>

      <section className={styles.sources} aria-labelledby="sources-title">
        <div><p className={styles.kicker}>Evidence trail</p><h2 id="sources-title">Approved sources used</h2></div>
        <ol>
          {sources.map((source) => (
            <li key={source.id}>
              <span className={styles.approvedDot} aria-hidden="true">✓</span>
              <div><strong>{source.date}</strong><p>Approved by {source.doctor}</p></div>
              <span className={styles.approvedLabel}>Approved</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className={styles.footer}>
        <p>AI-generated draft. Reviewed and approved by doctor before use. The AI does not diagnose, prescribe, or replace clinical judgment.</p>
        <Link href="/">Back to Smaran AI</Link>
      </footer>
    </main>
  );
}
