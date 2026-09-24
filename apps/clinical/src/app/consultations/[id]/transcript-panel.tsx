"use client";

import { Fragment, useMemo, useState } from "react";
import styles from "./record.module.css";

/**
 * The raw dialogue transcript, treated as SOURCE EVIDENCE rather than record text.
 *
 * A real consultation transcript runs to thousands of words, so dumping it in
 * full makes the page unusable. Instead it is folded to a readable window with an
 * explicit expand control, and is searchable — the common clinical need is
 * "where did they mention X", not "read the whole conversation".
 *
 * Kept visually and textually distinct from the approved note so machine
 * transcription is never mistaken for the clinician-approved record.
 */

const COLLAPSE_THRESHOLD = 900;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function TranscriptPanel({
  text,
  durationLabel,
  modelVersion,
  status,
}: {
  text: string;
  durationLabel: string | null;
  modelVersion: string | null;
  status: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const trimmed = text.trim();
  const isLong = trimmed.length > COLLAPSE_THRESHOLD;
  const searchTerm = query.trim();

  // Split on the search term so matches can be wrapped in <mark> without
  // injecting HTML. Odd indices are the matches.
  const parts = useMemo(() => {
    if (!searchTerm) return [trimmed];
    return trimmed.split(new RegExp(`(${escapeRegExp(searchTerm)})`, "gi"));
  }, [trimmed, searchTerm]);

  const matchCount = searchTerm ? Math.floor((parts.length - 1) / 2) : 0;
  const open = expanded || !isLong;

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const meta = [
    durationLabel && durationLabel !== "—" ? `Recording ${durationLabel}` : null,
    modelVersion ? `Model ${modelVersion}` : null,
    status ? status.replace(/_/g, " ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className={styles.block} id="transcript">
      <div className={styles.blockHead}>
        <h2>Dialogue transcript</h2>
        {meta ? <span className={styles.headlineMeta}>{meta}</span> : null}
      </div>

      {trimmed ? (
        <>
          <p className={styles.sourceNote}>
            Machine transcription of the consultation audio. Raw source, not part of the approved
            note — verify anything you rely on clinically.
          </p>

          <div className={styles.transcriptTools}>
            <input
              className={styles.searchBox}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a word or medicine in the transcript…"
              aria-label="Search the transcript"
            />
            {searchTerm ? (
              <span className={styles.matchCount}>
                {matchCount} {matchCount === 1 ? "match" : "matches"}
              </span>
            ) : null}
            <button type="button" className={styles.toolButton} onClick={() => void copyTranscript()}>
              {copied ? "Copied" : "Copy"}
            </button>
            {isLong ? (
              <button
                type="button"
                className={styles.toolButton}
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={open}
              >
                {expanded ? "Show less" : "Show full transcript"}
              </button>
            ) : null}
          </div>

          <div className={styles.transcriptBody} data-expanded={open}>
            {parts.map((part, index) =>
              index % 2 === 0 ? (
                <Fragment key={index}>{part}</Fragment>
              ) : (
                <mark key={index}>{part}</mark>
              )
            )}
            {!open ? <span className={styles.transcriptFade} aria-hidden="true" /> : null}
          </div>
        </>
      ) : (
        <p className={styles.muted}>
          No recording transcript exists for this visit — it was documented without recording, so the
          approved note is the only source.
        </p>
      )}
    </section>
  );
}
