import styles from "./demo.module.css";

/**
 * Visual structure for free-text note fields.
 *
 * The note is doctor-authored free text, so these helpers only change how it is
 * READ — they never reinterpret it. Specifically:
 *
 *  - nothing is inferred: a line is labelled only when it literally begins with
 *    a change verb the doctor typed;
 *  - nothing is dropped: the verb becomes a pill and the rest is shown in full,
 *    so the rendered text always covers the source;
 *  - nothing is reordered or merged;
 *  - colour encodes direction of change (started/stopped/up/down), never
 *    severity — the product must not imply clinical priority.
 *
 * Anything unrecognised renders verbatim as plain text.
 */

type Tone = "start" | "stop" | "up" | "down" | "swap";

const CHANGE_VERBS: Array<{ pattern: RegExp; label: string; tone: Tone }> = [
  { pattern: /^(started|start|initiate[sd]?|began|begin)\b/i, label: "Started", tone: "start" },
  { pattern: /^(stopped|stop|discontinued?|ceased|withdrawn)\b/i, label: "Stopped", tone: "stop" },
  { pattern: /^(increased|increase|up-?titrated|raised|uptitrated)\b/i, label: "Increased", tone: "up" },
  { pattern: /^(decreased|decrease|reduced|down-?titrated|lowered|downtitrated)\b/i, label: "Decreased", tone: "down" },
  { pattern: /^(substituted|substitute|switched|replaced|changed to)\b/i, label: "Substituted", tone: "swap" },
];

/** A sentence break immediately before a recognised change verb starts a new item. */
const SPLIT_BEFORE_VERB =
  /(?<=[.;])\s+(?=(?:started|stopped|increased|decreased|substituted|switched|discontinued|initiated|reduced|replaced|changed to)\b)/i;

const NOTHING_RECORDED = /^(none|no change[s]?|nil|not requested|not recorded|nothing)\b/i;

export function toItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line.split(SPLIT_BEFORE_VERB))
    .map((line) => line.replace(/^\s*(?:[-–—•*·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function classify(item: string): { label: string | null; tone: Tone | null; detail: string } {
  for (const verb of CHANGE_VERBS) {
    const match = item.match(verb.pattern);
    if (match) {
      const detail = item.slice(match[0].length).replace(/^[\s:—–-]+/, "").trim();
      return { label: verb.label, tone: verb.tone, detail };
    }
  }
  return { label: null, tone: null, detail: item };
}

/** Strips author list markers so the record does not render its own dashes. */
export function stripListMarkers(value: string | null | undefined): string {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-–—•*·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Merges ADJACENT items that share a direction. Order is never changed, so a
 * mixed sequence stays in the doctor's sequence — only runs of the same verb
 * collapse, which stops "Started / Started / Started" repeating down the page.
 */
function groupAdjacent(items: string[]): Array<{ label: string | null; tone: Tone | null; entries: string[] }> {
  const groups: Array<{ label: string | null; tone: Tone | null; entries: string[] }> = [];
  for (const item of items) {
    const { label, tone, detail } = classify(item);
    const entry = label ? detail || item : item;
    const last = groups[groups.length - 1];
    if (last && last.label === label && last.tone === tone) {
      last.entries.push(entry);
    } else {
      groups.push({ label, tone, entries: [entry] });
    }
  }
  return groups;
}

/** Medication changes: one grouped row per direction, then the medications. */
export function ChangeList({
  text,
  emptyLabel,
}: {
  text: string | null | undefined;
  emptyLabel: string;
}) {
  const value = (text ?? "").trim();
  if (!value || NOTHING_RECORDED.test(value)) {
    return <p className={styles.muted}>{emptyLabel}</p>;
  }

  return (
    <div className={styles.medList}>
      {groupAdjacent(toItems(value)).map((group, index) => (
        <div
          className={styles.medGroup}
          data-labelled={Boolean(group.label)}
          key={`${index}-${group.label ?? "item"}`}
        >
          {group.label && group.tone ? (
            <span className={styles.medChange} data-tone={group.tone}>
              {group.label}
            </span>
          ) : null}
          <ul className={styles.medGroupItems}>
            {group.entries.map((entry, entryIndex) => (
              <li key={`${entryIndex}-${entry}`}>{entry}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Investigations / plan: plain list when multi-item, prose when single. */
export function BulletList({
  text,
  emptyLabel,
}: {
  text: string | null | undefined;
  emptyLabel: string;
}) {
  const value = (text ?? "").trim();
  if (!value || NOTHING_RECORDED.test(value)) {
    return <p className={styles.muted}>{emptyLabel}</p>;
  }
  const items = toItems(value);
  if (items.length <= 1) {
    return <p className={styles.plainText}>{items[0] ?? value}</p>;
  }
  return (
    <ul className={styles.bulletList}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

/** The patient's own stated reason for the visit, given lead weight. */
export function PresentingComplaint({ text }: { text: string | null | undefined }) {
  const value = (text ?? "").trim();
  if (!value || NOTHING_RECORDED.test(value)) {
    return <p className={styles.muted}>No presenting complaint was recorded for this visit.</p>;
  }
  const items = toItems(value);
  if (items.length <= 1) {
    return <p className={styles.complaint}>{value}</p>;
  }
  return (
    <ul className={styles.complaintList}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}
