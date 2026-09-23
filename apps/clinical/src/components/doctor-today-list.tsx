"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentQueueItem } from "@/lib/db/appointment-queue";
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

function DoctorPatientRow({ item, busy, onOpen }: { item: AppointmentQueueItem; busy: boolean; onOpen: (item: AppointmentQueueItem) => void }) {
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
        <button className={styles.secondaryButton} disabled={busy} onClick={() => onOpen(item)}>{busy ? "Opening…" : "Review patient"}</button>
      ) : item.operationalStatus === "in_consultation" ? (
        <Link className={styles.secondaryButton} href={`/consultations/${item.consultationId}`}>Open</Link>
      ) : (
        <Link className={styles.secondaryButton} href={`/patients/${item.patientId}`}>Preview</Link>
      )}
    </li>
  );
}

export function DoctorTodayList({ items }: { items: AppointmentQueueItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const priorityItems = items.filter(
    (item) => item.isPriority && item.appointmentStatus === "scheduled" && item.operationalStatus !== "completed"
  );

  async function openPatient(item: AppointmentQueueItem) {
    setBusyId(item.appointmentId);
    setError(null);
    try {
      // Opening the doctor-only preparation surface must not transition the
      // authoritative queue state. Start Consultation remains explicit there.
      router.push(`/patients/${item.patientId}/preconsult?consultation=${item.consultationId}`);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open the consultation.");
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <section className={styles.panel}>
        <div className={styles.emptyState}>
          <strong>No patients today</strong>
          <p>Today&apos;s visits will appear here as they are added by the Clinic Desk.</p>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.doctorDaySections}>
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {priorityItems.length > 0 ? <div className={styles.prioritySummary} role="status"><Icon name="alert" /><div><strong>{priorityItems.length} human-marked priority {priorityItems.length === 1 ? "patient" : "patients"}</strong><span>{priorityItems.map((item) => item.patientName).join(", ")} · Queue order is unchanged</span></div></div> : null}

      <section className={styles.panel} aria-labelledby="doctor-day-heading">
        <div className={styles.panelTitle}>
          <div><p className={styles.eyebrow}>Today</p><h2 id="doctor-day-heading">Patient sequence</h2></div>
          <span className={styles.panelHint}>Operational view</span>
        </div>
        <ul className={styles.doctorDayList}>{items.map((item) => <DoctorPatientRow key={item.appointmentId} item={item} busy={busyId === item.appointmentId} onOpen={(patient) => void openPatient(patient)} />)}</ul>
      </section>
    </div>
  );
}
