"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentQueue, AppointmentQueueItem, QueueOperation, QueueReorderDirection } from "@/lib/db/appointment-queue";
import styles from "@/components/clinical.module.css";

function appointmentTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function waitingMinutes(value: string | null): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function priorityTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isActive(item: AppointmentQueueItem): boolean {
  return item.appointmentStatus === "scheduled" && item.operationalStatus !== "completed";
}

export function ClinicDeskToday({ queue }: { queue: AppointmentQueue }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorityEditorId, setPriorityEditorId] = useState<string | null>(null);
  const [priorityReason, setPriorityReason] = useState("");

  const waiting = queue.items.filter((item) => isActive(item) && item.operationalStatus === "waiting");
  const notArrived = queue.items.filter((item) => isActive(item) && ["scheduled", "preparing", "ready", "arrived"].includes(item.operationalStatus));
  const withDoctor = queue.items.filter((item) => isActive(item) && item.operationalStatus === "in_consultation");
  const completed = queue.items.filter((item) => item.appointmentStatus === "completed" || item.operationalStatus === "completed");
  const needsAction = queue.items.filter(
    (item) => isActive(item) && (item.intakeStatus !== "submitted" || item.documentStatus === "needs_review")
  );

  async function request(item: AppointmentQueueItem, path: string, method: "PATCH" | "POST", body: object) {
    setBusyId(item.appointmentId);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "That action could not be completed. Please try again.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "That action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  function queueAction(item: AppointmentQueueItem, operation: QueueOperation) {
    return request(item, `/api/appointments/${item.appointmentId}/queue`, "PATCH", { operation });
  }

  function reorder(item: AppointmentQueueItem, direction: QueueReorderDirection) {
    return request(item, `/api/appointments/${item.appointmentId}/queue`, "POST", { direction });
  }

  async function updatePriority(item: AppointmentQueueItem, isPriority: boolean) {
    await request(item, `/api/appointments/${item.appointmentId}/priority`, "PATCH", {
      isPriority,
      reason: isPriority ? priorityReason : undefined,
    });
    setPriorityEditorId(null);
    setPriorityReason("");
  }

  async function sendIntake(item: AppointmentQueueItem) {
    await request(item, `/api/appointments/${item.appointmentId}/intake`, "POST", {});
  }

  function renderRow(item: AppointmentQueueItem, waitingIndex?: number) {
    const busy = busyId === item.appointmentId;
    const wait = item.operationalStatus === "waiting" ? waitingMinutes(item.checkedInAt) : null;
    return (
      <li key={item.appointmentId} className={styles.deskQueueRow}>
        <div className={styles.deskQueueIdentity}>
          <time dateTime={item.scheduledAt}>{appointmentTime(item.scheduledAt)}</time>
          <div>
            <strong>{item.patientName}</strong>
            <span>{item.visitType === "new" ? "New patient" : "Follow-up"}{wait !== null ? ` · waiting ${wait} min` : ""}</span>
            {item.isPriority ? <span>Priority by {item.priorityUpdatedByName ?? "clinic staff"}{item.priorityUpdatedAt ? ` at ${priorityTime(item.priorityUpdatedAt)}` : ""}{item.priorityReason ? ` · ${item.priorityReason}` : ""}</span> : null}
          </div>
        </div>
        <div className={styles.deskQueueBadges}>
          {item.isPriority ? <span className={styles.priorityPill}>Priority</span> : null}
          {item.intakeStatus === "submitted" ? <span className={styles.statusBadge} data-tone="success">Details ready</span> : null}
        </div>
        <div className={styles.deskQueueActions}>
          {notArrived.some((candidate) => candidate.appointmentId === item.appointmentId) ? (
            <button className={styles.primaryButton} disabled={busy} onClick={() => void queueAction(item, "check_in")}>{busy ? "Checking in…" : "Check in"}</button>
          ) : null}
          {waitingIndex !== undefined ? (
            <>
              <button className={styles.compactButton} disabled={busy || waitingIndex === 0} onClick={() => void reorder(item, "earlier")}>Move earlier</button>
              <button className={styles.compactButton} disabled={busy || waitingIndex === waiting.length - 1} onClick={() => void reorder(item, "later")}>Move later</button>
            </>
          ) : null}
          {isActive(item) ? item.isPriority ? (
            <button className={styles.compactButton} disabled={busy} onClick={() => void updatePriority(item, false)}>Clear Priority</button>
          ) : (
            <button className={styles.compactButton} disabled={busy} onClick={() => setPriorityEditorId(item.appointmentId)}>Mark Priority</button>
          ) : null}
          <Link className={styles.secondaryButton} href={`/desk/patients/${item.patientId}`}>Open</Link>
        </div>
        {priorityEditorId === item.appointmentId ? (
          <div className={styles.priorityEditor}>
            <label>Reason or human observation (optional)<input maxLength={500} value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} placeholder="e.g. Patient requested earlier attention" /></label>
            <button className={styles.primaryButton} disabled={busy} onClick={() => void updatePriority(item, true)}>Confirm Priority</button>
            <button className={styles.compactButton} onClick={() => { setPriorityEditorId(null); setPriorityReason(""); }}>Cancel</button>
          </div>
        ) : null}
      </li>
    );
  }

  function renderSection(id: string, title: string, items: AppointmentQueueItem[], waitingSection = false, secondary = false) {
    if (items.length === 0) return null;
    return (
      <section className={`${styles.panel} ${secondary ? styles.secondaryDeskSection : ""}`} aria-labelledby={id}>
        <div className={styles.panelTitle}><h2 id={id}>{title}</h2><span className={styles.panelHint}>{items.length}</span></div>
        <ul className={styles.deskQueueList}>{items.map((item, index) => renderRow(item, waitingSection ? index : undefined))}</ul>
      </section>
    );
  }

  return (
    <div className={styles.deskSections}>
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {needsAction.length > 0 ? (
        <section className={`${styles.panel} ${styles.needsActionPanel}`} aria-labelledby="needs-action-heading">
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Exceptions only</p><h2 id="needs-action-heading">Needs your attention</h2></div><span className={styles.panelHint}>{needsAction.length}</span></div>
          <ul className={styles.needsActionList}>
            {needsAction.map((item) => (
              <li key={`action-${item.appointmentId}`}>
                <div><strong>{item.patientName}</strong><span>{item.documentStatus === "needs_review" ? "We couldn’t read a document clearly. The original is safe." : "Patient details are incomplete."}</span></div>
                <div>
                  {item.intakeStatus !== "submitted" ? <button className={styles.secondaryButton} disabled={busyId === item.appointmentId} onClick={() => void sendIntake(item)}>Send link</button> : null}
                  <Link className={styles.secondaryButton} href={`/desk/patients/${item.patientId}`}>{item.documentStatus === "needs_review" ? "Review document" : "Open patient"}</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {renderSection("waiting-heading", "Waiting", waiting, true)}
      {renderSection("not-arrived-heading", "Not arrived yet", notArrived)}
      {renderSection("with-doctor-heading", "With doctor", withDoctor)}
      {renderSection("completed-heading", "Completed", completed, false, true)}
      {queue.items.length === 0 ? <div className={styles.panel}><div className={styles.emptyState}><strong>No visits today</strong><p>Add a walk-in when the first patient arrives.</p></div></div> : null}
    </div>
  );
}
