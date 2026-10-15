"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  groupConsecutiveTurns,
  orderedSpeakerIds,
  parseDiarizedTurns,
  parseSpeakerRoleMap,
  speakerLabel,
} from "@/lib/audio-recording/speaker-roles";
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
  consultationId,
  diarizedTurns,
  speakerRoles,
}: {
  text: string;
  durationLabel: string | null;
  modelVersion: string | null;
  status: string | null;
  /** Only needed to persist a role correction. */
  consultationId?: string;
  /** Provider speaker attribution, when this visit was diarized. */
  diarizedTurns?: unknown;
  /** Inferred and/or doctor-confirmed speaker roles. */
  speakerRoles?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const router = useRouter();

  // Parsed defensively: older transcripts predate diarization, and a partially
  // written value must not break the panel.
  const turns = useMemo(() => parseDiarizedTurns(diarizedTurns), [diarizedTurns]);
  const roleMap = useMemo(() => parseSpeakerRoleMap(speakerRoles), [speakerRoles]);
  const speakerIds = useMemo(() => orderedSpeakerIds(turns), [turns]);
  const dialogue = useMemo(() => groupConsecutiveTurns(turns), [turns]);
  const hasDialogue = dialogue.length > 0;
  const isConfirmed = roleMap?.source === "doctor_confirmed";

  const trimmed = text.trim();
  const isLong = trimmed.length > COLLAPSE_THRESHOLD;
  const searchTerm = query.trim();

  // Split on the search term so matches can be wrapped in <mark> without
  // injecting HTML. Odd indices are the matches.
  const parts = useMemo(() => {
    if (!searchTerm) return [trimmed];
    return trimmed.split(new RegExp(`(${escapeRegExp(searchTerm)})`, "gi"));
  }, [trimmed, searchTerm]);

  /** The same non-injecting highlighting, applied to a single dialogue turn. */
  const highlight = (value: string) => {
    if (!searchTerm) return value;
    return value
      .split(new RegExp(`(${escapeRegExp(searchTerm)})`, "gi"))
      .map((segment, index) =>
        index % 2 === 1 ? (
          <mark key={index}>{segment}</mark>
        ) : (
          <Fragment key={index}>{segment}</Fragment>
        )
      );
  };

  const matchCount = searchTerm ? Math.floor((parts.length - 1) / 2) : 0;
  const open = expanded || !isLong;

  async function swapRoles() {
    if (!consultationId) return;
    setSwapping(true);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/transcript`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap_speaker_roles" }),
      });
      if (response.ok) router.refresh();
    } finally {
      setSwapping(false);
    }
  }

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

          {hasDialogue ? (
            <div className={styles.speakerRoles} role="status">
              <span>
                {isConfirmed
                  ? "Speaker roles confirmed by you."
                  : roleMap
                    ? `Speaker roles inferred \u00b7 ${roleMap.reason}`
                    : "Speakers were separated, but the roles could not be told apart. Read them as Speaker 1 and Speaker 2."}
              </span>
              {!isConfirmed && roleMap && consultationId ? (
                <button
                  type="button"
                  className={styles.toolButton}
                  onClick={() => void swapRoles()}
                  disabled={swapping}
                >
                  {swapping ? "Swapping\u2026" : "Not right? Swap"}
                </button>
              ) : null}
            </div>
          ) : null}

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

          {hasDialogue ? (
            <ol className={styles.transcriptDialogue} data-expanded={open}>
              {dialogue.map((turn, index) => {
                const role = roleMap?.roles?.[turn.speakerId] ?? "unknown";
                return (
                  <li key={index} data-role={role}>
                    <span className={styles.transcriptSpeaker}>
                      {speakerLabel(turn.speakerId, roleMap, speakerIds)}
                    </span>
                    <p>{highlight(turn.transcript)}</p>
                  </li>
                );
              })}
              {!open ? <span className={styles.transcriptFade} aria-hidden="true" /> : null}
            </ol>
          ) : (
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
          )}
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
