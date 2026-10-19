"use client";

import type { AppointmentQueueItem } from "@/lib/db/appointment-queue";
import Link from "next/link";
import { PendingLink } from "@/components/pending-link";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";

function appointmentTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function priorityTime(value: string | null): string {
  if (!value) return "";
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

function statusLabel(item: AppointmentQueueItem): string {
  if (item.appointmentStatus === "completed" || item.operationalStatus === "completed") return "Completed";
  if (item.operationalStatus === "waiting") return "Waiting";
  if (item.operationalStatus === "in_consultation") return "With doctor";
  return "Not arrived yet";
}

function DoctorPatientRow({ item }: { item: AppointmentQueueItem }) {
  const wait = item.operationalStatus === "waiting" ? waitingMinutes(item.checkedInAt) : null;
  return (
    <li className={styles.doctorDayRow}>
      <time dateTime={item.scheduledAt}>{appointmentTime(item.scheduledAt)}</time>
      <div>
        <strong>{item.patientName}</strong>
        <span>{item.visitType === "new" ? "New patient" : "Follow-up"}</span>
        {item.isPriority ? (
          <span>
            Marked by {item.priorityUpdatedByName ?? "clinic staff"}
            {item.priorityUpdatedByRole ? ` (${item.priorityUpdatedByRole})` : ""}
            {item.priorityUpdatedAt ? ` at ${priorityTime(item.priorityUpdatedAt)}` : ""}
            {item.priorityReason ? ` · ${item.priorityReason}` : ""}
          </span>
        ) : null}
      </div>
      <span className={styles.statusBadge} data-tone={item.operationalStatus === "waiting" ? "warning" : "neutral"}>
        {statusLabel(item)}{wait !== null ? ` · ${wait} min` : ""}
      </span>
      {item.isPriority ? <span className={styles.priorityPill}>Priority</span> : null}
      {item.operationalStatus === "waiting" ? (
        // Opening the doctor-only preparation surface must not transition the
        // authoritative queue state. Start Consultation remains explicit there.
        <PendingLink className={styles.secondaryButton} href={`/patients/${item.patientId}/preconsult?consultation=${item.consultationId}`}>Review patient</PendingLink>
      ) : item.operationalStatus === "in_consultation" ? (
        <PendingLink className={styles.secondaryButton} href={`/consultations/${item.consultationId}`}>Open</PendingLink>
      ) : (
        <PendingLink className={styles.secondaryButton} href={`/patients/${item.patientId}`}>Preview</PendingLink>
      )}
    </li>
  );
}

export function DoctorTodayList({ items }: { items: AppointmentQueueItem[] }) {
  const priorityItems = items.filter(
    (item) => item.isPriority && item.appointmentStatus === "scheduled" && item.operationalStatus !== "completed"
  );

  if (items.length === 0) {
    return (
      <section className={`${styles.panel} ${styles.doctorSequencePanel}`} aria-labelledby="doctor-day-heading">
        <div className={styles.panelTitle}>
          <div><p className={styles.eyebrow}>Today</p><h2 id="doctor-day-heading">Patient sequence</h2></div>
          <Link href="/scheduler?workspace=clinical" className={styles.secondaryButton}><Icon name="calendar" /> View schedule</Link>
        </div>
        <div className={styles.emptyState}>
          <strong>No patients today</strong>
          <p>Today&apos;s visits will appear here as they are added by the Clinic Desk.</p>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.doctorDaySections}>
      {priorityItems.length > 0 ? <div className={styles.prioritySummary} role="status"><Icon name="alert" /><div><strong>{priorityItems.length} human-marked priority {priorityItems.length === 1 ? "patient" : "patients"}</strong><span>{priorityItems.map((item) => item.patientName).join(", ")} · Queue order is unchanged</span></div></div> : null}

      <section className={`${styles.panel} ${styles.doctorSequencePanel}`} aria-labelledby="doctor-day-heading">
        <div className={styles.panelTitle}>
          <div><p className={styles.eyebrow}>Today</p><h2 id="doctor-day-heading">Patient sequence</h2></div>
          <div className={styles.sequenceHeaderActions}>
            <span className={styles.panelHint}>Operational view</span>
            <Link href="/scheduler?workspace=clinical" className={styles.secondaryButton}><Icon name="calendar" /> View schedule</Link>
          </div>
        </div>
        <ul className={styles.doctorDayList}>{items.map((item) => <DoctorPatientRow key={item.appointmentId} item={item} />)}</ul>
      </section>
    </div>
  );
}
