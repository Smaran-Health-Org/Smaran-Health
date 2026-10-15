"use client";

import type { PendingReviewItem } from "@/lib/db/dashboard";
import { PendingLink } from "@/components/pending-link";
import styles from "@/components/clinical.module.css";

/**
 * Surfaces visits whose transcript arrived after the doctor left and were drafted
 * in the background. Without this, that recovery work exists in the database and
 * nowhere the doctor will ever look.
 *
 * Renders nothing when there is no backlog, so the Today surface is byte-identical
 * on a normal day. Everything shown here is unconfirmed AI output and is labelled
 * as such; nothing on this panel approves, scores, or prioritises a patient.
 */

function visitTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PendingReviewList({
  items,
  hasMore,
}: {
  items: PendingReviewItem[];
  hasMore: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className={styles.panel} aria-labelledby="pending-review-heading">
      <div className={styles.panelTitle}>
        <div>
          <p className={styles.eyebrow}>Waiting on you</p>
          <h2 id="pending-review-heading">Drafts ready for review</h2>
        </div>
        <span className={styles.panelHint}>AI draft · not reviewed</span>
      </div>
      <ul className={styles.doctorDayList}>
        {items.map((item) => (
          <li className={styles.doctorDayRow} key={item.consultationId}>
            <time dateTime={item.startedAt ?? undefined}>{visitTime(item.startedAt)}</time>
            <div>
              <strong>{item.patientFullName ?? "Patient"}</strong>
              <span title={item.draftPreview ?? undefined}>
                {item.draftPreview ?? "Draft captured — open to review."}
              </span>
            </div>
            <span className={styles.statusBadge} data-tone="info">
              Draft ready
            </span>
            <PendingLink
              className={styles.secondaryButton}
              href={`/consultations/${item.consultationId}`}
            >
              Review
            </PendingLink>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <p className={styles.panelHint}>
          Showing the most recent drafts. Open the patient record for older visits.
        </p>
      ) : null}
    </section>
  );
}
