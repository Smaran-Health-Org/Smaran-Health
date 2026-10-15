"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentQueue, AppointmentQueueItem, QueueOperation, QueueReorderDirection } from "@/lib/db/appointment-queue";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";

function appointmentTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function waitingMinutes(value: string | null): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function isActive(item: AppointmentQueueItem): boolean {
  return item.appointmentStatus === "scheduled" && item.operationalStatus !== "completed";
}

function preparationSummary(item: AppointmentQueueItem): string {
  if (item.documentStatus === "needs_review") return "Report needs attention";
  if (item.documentStatus === "processing") return "Reports processing";
  if (item.intakeStatus === "submitted") return "Details ready";
  if (item.intakeStatus === "in_progress") return "Details in progress";
  return "Details pending";
}

function patientToken(item: AppointmentQueueItem): string {
  return item.queueOrder === null ? "—" : `#${item.queueOrder}`;
}

export function ClinicDeskToday({ queue }: { queue: AppointmentQueue }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorityEditorId, setPriorityEditorId] = useState<string | null>(null);
  const [priorityReason, setPriorityReason] = useState("");
  const [draggedAppointmentId, setDraggedAppointmentId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState<"expected" | "waiting" | "doctor" | "completed">("expected");
  const waiting = queue.items.filter((item) => isActive(item) && item.operationalStatus === "waiting");
  const notArrived = queue.items.filter((item) => isActive(item) && ["scheduled", "preparing", "ready", "arrived"].includes(item.operationalStatus));
  const withDoctor = queue.items.filter((item) => isActive(item) && item.operationalStatus === "in_consultation");
  const completed = queue.items.filter((item) => item.appointmentStatus === "completed" || item.operationalStatus === "completed");
  const needsAction = queue.items.filter((item) => isActive(item) && (item.intakeStatus !== "submitted" || item.documentStatus === "needs_review"));

  async function request(item: AppointmentQueueItem, path: string, method: "PATCH" | "POST", body: object) {
    setBusyId(item.appointmentId);
    setError(null);
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  async function reorderWaitingCards(target: AppointmentQueueItem) {
    if (!draggedAppointmentId || draggedAppointmentId === target.appointmentId) return;
    const sourceIndex = waiting.findIndex((item) => item.appointmentId === draggedAppointmentId);
    const targetIndex = waiting.findIndex((item) => item.appointmentId === target.appointmentId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const source = waiting[sourceIndex];
    const direction = sourceIndex < targetIndex ? "later" : "earlier";
    const steps = Math.abs(sourceIndex - targetIndex);
    setBusyId(source.appointmentId);
    setError(null);
    try {
      for (let step = 0; step < steps; step += 1) {
        const response = await fetch(`/api/appointments/${source.appointmentId}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction }),
        });
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || "That queue change could not be completed. Please try again.");
      }
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "That queue change could not be completed.");
    } finally {
      setBusyId(null);
      setDraggedAppointmentId(null);
      setDropTargetId(null);
    }
  }
  async function updatePriority(item: AppointmentQueueItem, isPriority: boolean) {
    await request(item, `/api/appointments/${item.appointmentId}/priority`, "PATCH", { isPriority, reason: isPriority ? priorityReason : undefined });
    setPriorityEditorId(null);
    setPriorityReason("");
  }
  async function sendIntake(item: AppointmentQueueItem) {
    await request(item, `/api/appointments/${item.appointmentId}/intake`, "POST", {});
  }

  function renderCard(item: AppointmentQueueItem, waitingIndex?: number) {
    const busy = busyId === item.appointmentId;
    const wait = item.operationalStatus === "waiting" ? waitingMinutes(item.checkedInAt) : null;
    const isExpected = notArrived.some((candidate) => candidate.appointmentId === item.appointmentId);
    return (
      <li
        key={item.appointmentId}
        className={styles.deskBoardCard}
        data-dragging={draggedAppointmentId === item.appointmentId}
        data-drop-target={dropTargetId === item.appointmentId}
        draggable={waitingIndex !== undefined && !busy}
        tabIndex={0}
        aria-label={`${item.patientName}. Open operational patient view${waitingIndex !== undefined ? ". Use Alt plus Up or Down Arrow to change queue position." : ""}`}
        onClick={() => router.push(`/desk/patients/${item.patientId}`)}
        onKeyDown={(event) => {
          // Nested controls own their keyboard events. Card shortcuts must not
          // navigate away from a button activation or an in-progress edit.
          if (event.target !== event.currentTarget) return;
          if (waitingIndex !== undefined && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            event.stopPropagation();
            void reorder(item, event.key === "ArrowUp" ? "earlier" : "later");
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            router.push(`/desk/patients/${item.patientId}`);
          }
        }}
        onDragStart={(event) => {
          if (waitingIndex === undefined) return;
          event.dataTransfer.effectAllowed = "move";
          setDraggedAppointmentId(item.appointmentId);
        }}
        onDragEnter={() => { if (draggedAppointmentId && draggedAppointmentId !== item.appointmentId) setDropTargetId(item.appointmentId); }}
        onDragOver={(event) => { if (waitingIndex !== undefined && draggedAppointmentId !== item.appointmentId) event.preventDefault(); }}
        onDragEnd={() => { setDraggedAppointmentId(null); setDropTargetId(null); }}
        onDrop={(event) => { event.preventDefault(); void reorderWaitingCards(item); }}
      >
        <div className={styles.deskCardHeader}>
          <span className={styles.deskToken}>{patientToken(item)}</span>
          <span className={styles.deskCardTime} data-urgent={wait !== null && wait >= 30}>{wait !== null ? `${wait} min` : appointmentTime(item.scheduledAt)}</span>
        </div>
        <div className={styles.deskCardIdentity}>
          <strong>{item.patientName}</strong>
          <span>{item.visitType === "new" ? "New patient" : "Follow-up"}</span>
        </div>
        <div className={styles.deskCardHighlights}>
          <span>{wait !== null ? `Checked in ${appointmentTime(item.checkedInAt ?? item.scheduledAt)}` : `Expected at ${appointmentTime(item.scheduledAt)}`}</span>
          <span>{preparationSummary(item)}</span>
        </div>
        <div className={styles.deskCardFooter}>
          <div className={styles.deskCardMarkers}>
            {item.isPriority ? <span className={styles.priorityPill}>Priority</span> : null}
            {item.intakeStatus === "submitted" ? <span className={styles.statusBadge} data-tone="success">Details ready</span> : null}
          </div>
        </div>
        <div className={styles.deskCardActions}>
          {waitingIndex !== undefined ? <div className={styles.deskReorderActions} aria-label="Queue position controls">
            <button type="button" className={styles.iconButton} title="Move earlier" aria-label={`Move ${item.patientName} earlier`} disabled={busy || waitingIndex === 0} onClick={(event) => { event.stopPropagation(); void reorder(item, "earlier"); }}><Icon name="arrowLeft" /></button>
            <button type="button" className={styles.iconButton} title="Move later" aria-label={`Move ${item.patientName} later`} disabled={busy || waitingIndex === waiting.length - 1} onClick={(event) => { event.stopPropagation(); void reorder(item, "later"); }}><Icon name="arrowRight" /></button>
          </div> : null}
          {isExpected ? <button className={styles.primaryButton} disabled={busy} onClick={(event) => { event.stopPropagation(); void queueAction(item, "check_in"); }}>{busy ? "Checking in…" : "Check in →"}</button> : null}
          {isActive(item) ? item.isPriority ? <button className={styles.compactButton} disabled={busy} onClick={(event) => { event.stopPropagation(); void updatePriority(item, false); }}>Clear Priority</button> : <button className={styles.compactButton} disabled={busy} onClick={(event) => { event.stopPropagation(); setPriorityEditorId(item.appointmentId); }}>Mark Priority</button> : null}
        </div>
        {priorityEditorId === item.appointmentId ? <div className={styles.priorityEditor}>
          <label>Reason or human observation (optional)<input maxLength={500} value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} placeholder="e.g. Patient requested earlier attention" /></label>
          <button className={styles.primaryButton} disabled={busy} onClick={(event) => { event.stopPropagation(); void updatePriority(item, true); }}>Confirm Priority</button>
          <button className={styles.compactButton} onClick={(event) => { event.stopPropagation(); setPriorityEditorId(null); setPriorityReason(""); }}>Cancel</button>
        </div> : null}
      </li>
    );
  }

  function renderBoardColumn(id: string, title: string, description: string, items: AppointmentQueueItem[], stage: "expected" | "waiting" | "doctor" | "completed") {
    return <section className={styles.deskBoardColumn} data-stage={stage} aria-labelledby={id}>
      <div className={styles.deskBoardColumnHeader}><div><h2 id={id}>{title}</h2><p>{description}</p></div><span>{items.length}</span></div>
      {items.length > 0 ? <ul className={styles.deskBoardList}>{items.map((item, index) => renderCard(item, stage === "waiting" ? index : undefined))}</ul> : <p className={styles.deskBoardEmpty}>No patients in this stage.</p>}
    </section>;
  }

  return <div className={styles.deskSections}>
    {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
    {needsAction.length > 0 ? <details open className={`${styles.panel} ${styles.needsActionPanel} ${styles.needsActionDisclosure}`}>
      <summary><div><p className={styles.eyebrow}>Exceptions only</p><h2 id="needs-action-heading">Needs your attention</h2></div><span className={styles.panelHint}>{needsAction.length}</span></summary>
      <ul className={styles.needsActionList}>{needsAction.map((item) => <li key={`action-${item.appointmentId}`}>
        <div><strong>{item.patientName}</strong><span>{item.documentStatus === "needs_review" ? "We couldn’t read a document clearly. The original is safe." : "Patient details are incomplete."}</span></div>
        <div>{item.intakeStatus !== "submitted" ? <button className={styles.secondaryButton} disabled={busyId === item.appointmentId} onClick={() => void sendIntake(item)}>Send link</button> : null}<Link className={styles.secondaryButton} href={`/desk/patients/${item.patientId}`}>{item.documentStatus === "needs_review" ? "Review document" : "Open patient"}</Link></div>
      </li>)}</ul>
    </details> : null}
    <section className={styles.deskBoard} aria-label="Today’s patient journey board">
      <div className={styles.deskBoardIntro}><div><p className={styles.eyebrow}>Today’s patient journey</p><h2>Move patients through the day</h2></div></div>
      <div className={styles.deskBoardColumns}>
        {renderBoardColumn("not-arrived-heading", "Expected", "Awaiting check-in", notArrived, "expected")}
        {renderBoardColumn("waiting-heading", "Waiting", "Checked in and queued", waiting, "waiting")}
        {renderBoardColumn("with-doctor-heading", "With doctor", "Consultation in progress", withDoctor, "doctor")}
        {renderBoardColumn("completed-heading", "Completed", "Visit complete", completed, "completed")}
      </div>
      <div className={styles.mobileJourney}>
        <div className={styles.mobileJourneyStages} role="group" aria-label="Patient journey stages">
          {([
            ["expected", "Expected", notArrived.length],
            ["waiting", "Waiting", waiting.length],
            ["doctor", "With doctor", withDoctor.length],
            ["completed", "Done", completed.length],
          ] as const).map(([stage, label, count]) => <button key={stage} type="button" aria-pressed={mobileStage === stage} aria-controls="mobile-journey-stage" className={styles.mobileJourneyStage} onClick={() => setMobileStage(stage)}><span>{label}</span><strong>{count}</strong></button>)}
        </div>
        <section id="mobile-journey-stage" className={styles.mobileJourneyPanel} aria-label={`${mobileStage === "expected" ? "Expected" : mobileStage === "waiting" ? "Waiting" : mobileStage === "doctor" ? "With doctor" : "Done"} patients`}>
          {renderBoardColumn("mobile-journey-heading", mobileStage === "expected" ? "Expected" : mobileStage === "waiting" ? "Waiting" : mobileStage === "doctor" ? "With doctor" : "Done", "", mobileStage === "expected" ? notArrived : mobileStage === "waiting" ? waiting : mobileStage === "doctor" ? withDoctor : completed, mobileStage)}
        </section>
      </div>
    </section>
    {queue.items.length === 0 ? <div className={styles.panel}><div className={styles.emptyState}><strong>No visits today</strong><p>Add a walk-in when the first patient arrives.</p></div></div> : null}
  </div>;
}
