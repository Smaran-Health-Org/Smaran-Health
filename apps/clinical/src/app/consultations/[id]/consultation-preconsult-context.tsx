"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";
import type { PreconsultBrief } from "@/lib/preconsult/contract";
import type { PreconsultBriefAtConsultationStart } from "@/lib/preconsult/consultation-start";
import { preconsultEvidenceHref, preconsultEvidenceLabel } from "@/lib/preconsult/evidence-links";
import { preconsultVerificationLabel } from "@/lib/preconsult/verification-label";

type ConsultationPreconsultContextProps = {
  patientId: string;
  context: PreconsultBriefAtConsultationStart;
};

function Claims({
  patientId,
  claims,
}: {
  patientId: string;
  claims: Array<{ id: string; text: string; verification: string; sources: PreconsultBrief["evidenceSummary"] }>;
}) {
  if (!claims.length) {
    return <p className={styles.consultationPreconsultEmpty}>No supported information is available in this section.</p>;
  }

  return (
    <div className={styles.consultationPreconsultClaims}>
      {claims.map((claim) => (
        <article key={claim.id}>
          <strong>{preconsultVerificationLabel(claim.verification)}</strong>
          <p>{claim.text}</p>
          <div>
            {claim.sources.map((source) => (
              <Link
                className={styles.panelLink}
                href={preconsultEvidenceHref(patientId, source)}
                key={`${source.type}-${source.id}-${source.page ?? ""}-${source.itemIndex ?? ""}`}
                prefetch={false}
                rel="noreferrer"
                target="_blank"
              >
                {preconsultEvidenceLabel(source)}
              </Link>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function Brief({ patientId, brief }: { patientId: string; brief: PreconsultBrief }) {
  const whyTodayVerification = brief.whyToday.provenance === "unknown"
    ? "needs_review"
    : "patient_reported_unconfirmed";

  return (
    <div className={styles.consultationPreconsultContent}>
      <section>
        <h3>Why today?</h3>
        <article className={styles.consultationPreconsultWhyToday}>
          <strong>{preconsultVerificationLabel(whyTodayVerification)}</strong>
          <p>{brief.whyToday.verbatim ?? "No reason for visit was submitted."}</p>
        </article>
      </section>

      <section>
        <h3>{brief.mode === "returning" ? "What changed?" : "Patient overview"}</h3>
        <Claims patientId={patientId} claims={brief.mode === "returning" ? brief.changes : brief.patientOverview} />
      </section>

      <section>
        <h3>What needs attention?</h3>
        <Claims patientId={patientId} claims={brief.needsAttention} />
      </section>

      <section>
        <h3>What do I already know?</h3>
        {brief.alreadyKnown.lastVisit && (
          <article className={styles.consultationPreconsultLastVisit}>
            <strong>Last approved visit</strong>
            <p>{brief.alreadyKnown.lastVisit.summary ?? "No summary was recorded."}</p>
          </article>
        )}
        <Claims patientId={patientId} claims={brief.alreadyKnown.approvedMemory} />
      </section>
    </div>
  );
}

/** Local UI state only: toggling this surface never changes consultation state. */
export function ConsultationPreconsultContext({ patientId, context }: ConsultationPreconsultContextProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = "consultation-preconsult-context";

  return (
    <section className={styles.consultationPreconsultContext} aria-labelledby="consultation-preconsult-context-title">
      <div className={styles.consultationPreconsultHeader}>
        <div>
          <p>Preparation aid — not clinical source of truth.</p>
          <h2 id="consultation-preconsult-context-title">Pre-consult context at consultation start</h2>
        </div>
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className={styles.consultationPreconsultToggle}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Collapse" : "View context"} <Icon name="chevron" />
        </button>
      </div>

      {expanded && (
        <div id={contentId}>
          {context.status === "brief_available" ? (
            <Brief patientId={patientId} brief={context.payload} />
          ) : (
            <p className={styles.consultationPreconsultEmpty}>
              {context.status === "none_available"
                ? "No pre-consult brief was available when this consultation started."
                : "Pre-consult context is unavailable."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
