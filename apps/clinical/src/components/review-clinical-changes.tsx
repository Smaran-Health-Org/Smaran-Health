"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/components/clinical.module.css";
import type { PendingClinicalStateDelta } from "@/lib/db/clinical-state";
import { clinicalStateReviewCommandIdentity, clinicalStateReviewComparisonIsActionable, clinicalStateReviewComparisonPresentation, MAX_REVIEW_BATCH_SIZE, remainingClinicalStateReviewDeltas, type ClinicalStateReviewComparison, type ClinicalStateReviewDecision } from "@/lib/clinical-state/review-command";

type Decision = "accept" | "keep_current";

function stateText(value: PendingClinicalStateDelta["proposedValue"]) {
  return value.regimenText ? `${value.displayName} · ${value.regimenText}` : `${value.displayName} · ${value.valueText}`;
}

function label(value: string) {
  return value.replace(/^possible_/, "Possible ").replaceAll("_", " ");
}

function deltaEvidenceHref(patientId: string, deltaId: string) {
  return `/patients/${patientId}/preconsult/evidence?${new URLSearchParams({ type: "delta", source: deltaId }).toString()}`;
}

export function ReviewClinicalChanges({
  patientId, deltas, comparisons,
}: {
  patientId: string;
  deltas: PendingClinicalStateDelta[];
  comparisons: Record<string, ClinicalStateReviewComparison>;
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locallyResolvedIds, setLocallyResolvedIds] = useState<ReadonlySet<string>>(() => new Set());
  const command = useRef<{ identity: string; idempotencyKey: string } | null>(null);
  const visible = useMemo(() => remainingClinicalStateReviewDeltas(deltas, locallyResolvedIds), [deltas, locallyResolvedIds]);
  const focused = visible[Math.min(index, Math.max(visible.length - 1, 0))];
  const comparisonFor = (delta: PendingClinicalStateDelta): ClinicalStateReviewComparison => comparisons[delta.id] ?? { status: "refresh_required" };
  const staged = visible.filter((delta) => decisions[delta.id] && clinicalStateReviewComparisonIsActionable(comparisonFor(delta)));
  const focusedComparison = focused ? comparisonFor(focused) : null;
  const focusedPresentation = clinicalStateReviewComparisonPresentation(focusedComparison ?? undefined);
  const focusedActionable = focusedPresentation.actionable;

  function choose(action: Decision) {
    if (!focused || !clinicalStateReviewComparisonIsActionable(comparisonFor(focused))) return;
    if (!decisions[focused.id] && staged.length >= MAX_REVIEW_BATCH_SIZE) {
      setMessage(`Apply the first ${MAX_REVIEW_BATCH_SIZE} reviewed changes before staging more.`);
      return;
    }
    setDecisions((previous) => ({ ...previous, [focused.id]: action }));
    setMessage(null);
    if (index < visible.length - 1) setIndex(index + 1);
  }

  async function apply() {
    if (!staged.length || submitting) return;
    setSubmitting(true); setMessage(null);
    try {
      const submittedDecisions: ClinicalStateReviewDecision[] = staged.map((delta) => ({
        deltaId: delta.id, action: decisions[delta.id], expectedBaseStateVersionId: delta.baseStateVersionId,
        expectedEffectiveSourceRevision: delta.effectiveSourceRevision,
      }));
      const identity = clinicalStateReviewCommandIdentity(submittedDecisions);
      if (command.current?.identity !== identity) command.current = { identity, idempotencyKey: crypto.randomUUID() };
      const response = await fetch(`/api/patients/${patientId}/clinical-state-deltas/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: command.current.idempotencyKey, decisions: submittedDecisions }),
      });
      const body = await response.json().catch(() => null) as { error?: string; details?: { outcome?: string }; result?: { outcome?: string } } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not apply reviewed changes");
      const submittedIds = new Set(staged.map((delta) => delta.id));
      setLocallyResolvedIds((previous) => new Set([...previous, ...submittedIds]));
      setDecisions((previous) => Object.fromEntries(Object.entries(previous).filter(([deltaId]) => !submittedIds.has(deltaId))));
      setIndex(0);
      command.current = null;
      setMessage(body?.result?.outcome === "exact_replay" ? "The same reviewed changes were already applied." : "Reviewed changes were applied. The pre-consult brief will refresh in the background.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply reviewed changes");
    } finally { setSubmitting(false); }
  }

  if (!visible.length) return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Review Changes</p><h2>{locallyResolvedIds.size ? "Changes applied" : "No unresolved changes"}</h2></div></div><p className={styles.memorySummary}>{message ?? "There are no unresolved proposed clinical changes for this patient."}</p></section>;

  return <div className={styles.reviewLayout}>
    <section className={styles.panel} aria-live="polite">
      <div className={styles.panelTitle}><div><p className={styles.eyebrow}>One change at a time · {Math.min(index + 1, visible.length)} of {visible.length}</p><h2>{focused.proposedValue.displayName}</h2></div><span className={styles.reviewTag}>{focusedActionable ? label(focused.classification) : "Refresh required"}</span></div>
      <div className={styles.reviewComparison}><div><span>Current confirmed record</span><strong>{typeof focusedPresentation.currentRecord === "string" ? focusedPresentation.currentRecord : stateText(focusedPresentation.currentRecord)}</strong></div><div><span>Proposed from external/patient evidence</span><strong>{stateText(focused.proposedValue)}</strong></div></div>
      {focusedActionable ? <p className={styles.memorySummary}>This proposal is unconfirmed until you apply an explicit doctor decision.</p> : <p className={styles.memorySummary}>The confirmed record could not be loaded. Refresh this change before reviewing it.</p>}
      <Link className={styles.panelLink} href={deltaEvidenceHref(patientId, focused.id)} target="_blank" rel="noreferrer">View source evidence and provenance in a new tab</Link>
      <div className={styles.reviewActions}><button type="button" className={decisions[focused.id] === "accept" ? styles.primaryButton : styles.secondaryButton} disabled={!focusedActionable} onClick={() => choose("accept")}>Accept</button><button type="button" className={decisions[focused.id] === "keep_current" ? styles.primaryButton : styles.secondaryButton} disabled={!focusedActionable} onClick={() => choose("keep_current")}>Keep existing</button>{!focusedActionable ? <button type="button" className={styles.secondaryButton} onClick={() => router.refresh()}>Refresh changes</button> : null}</div>
      <div className={styles.reviewNavigation}><button type="button" className={styles.secondaryButton} disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</button><button type="button" className={styles.secondaryButton} disabled={index >= visible.length - 1} onClick={() => setIndex(index + 1)}>Next</button></div>
    </section>
    <aside className={styles.reviewSidebar}><section className={styles.panel}><p className={styles.eyebrow}>Staged locally</p><h2>{staged.length} decision{staged.length === 1 ? "" : "s"} ready</h2><p className={styles.memorySummary}>Nothing is saved until you apply these reviewed changes.</p><button type="button" className={styles.primaryButton} disabled={!staged.length || submitting} onClick={apply}>{submitting ? "Applying…" : `Apply ${staged.length || ""} reviewed changes`}</button>{message ? <p className={styles.reviewMessage} role="status">{message}</p> : null}</section>
    </aside>
  </div>;
}
