"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { DocumentManager } from "@/components/document-manager";
import type {
  AppointmentQueue,
  AppointmentQueueItem,
  QueueOperation,
} from "@/lib/db/appointment-queue";
import type { SessionContext } from "@/types";
import styles from "@/components/clinical.module.css";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function appointmentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function operationalStatus(item: AppointmentQueueItem): {
  label: string;
  tone: string;
} {
  if (item.appointmentStatus === "cancelled") return { label: "Cancelled", tone: "danger" };
  if (item.appointmentStatus === "no_show") return { label: "No-show", tone: "danger" };
  if (item.appointmentStatus === "completed") return { label: "Completed", tone: "success" };

  switch (item.operationalStatus) {
    case "arrived":
      return { label: "Arrived", tone: "info" };
    case "waiting":
      return { label: "Waiting", tone: "warning" };
    case "in_consultation":
      return { label: "In consultation", tone: "success" };
    case "completed":
      return { label: "Completed", tone: "success" };
    case "preparing":
      return { label: "Preparing", tone: "info" };
    case "ready":
      return { label: "Ready", tone: "success" };
    default:
      return { label: "Scheduled", tone: "neutral" };
  }
}

function queueActions(
  item: AppointmentQueueItem,
  role: SessionContext["role"]
): Array<{ operation: QueueOperation; label: string; primary?: boolean }> {
  if (item.appointmentStatus !== "scheduled" || item.operationalStatus === "completed") return [];

  const actions: Array<{ operation: QueueOperation; label: string; primary?: boolean }> = [];
  if (["scheduled", "preparing", "ready"].includes(item.operationalStatus)) {
    actions.push({ operation: "mark_arrived", label: "Mark arrived" });
  }
  if (item.operationalStatus === "arrived") {
    actions.push({ operation: "mark_waiting", label: "Mark waiting" });
  }
  if (role === "doctor" && item.operationalStatus !== "in_consultation") {
    actions.push({ operation: "start_consultation", label: "Start consultation", primary: true });
  }
  return actions;
}

export function TodayPatientsList({
  queue,
  role,
}: {
  queue: AppointmentQueue;
  role: SessionContext["role"];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pendingAppointmentId, setPendingAppointmentId] = useState<string | null>(null);
  const [documentAppointmentId, setDocumentAppointmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intakePreview, setIntakePreview] = useState<{
    patientName: string;
    intakeUrl: string;
  } | null>(null);
  const [intakeNotice, setIntakeNotice] = useState<string | null>(null);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return queue.items;
    return queue.items.filter((item) => item.patientName.toLocaleLowerCase().includes(normalized));
  }, [queue.items, query]);

  async function performOperation(item: AppointmentQueueItem, operation: QueueOperation) {
    setError(null);
    setPendingAppointmentId(item.appointmentId);
    try {
      const response = await fetch(`/api/appointments/${item.appointmentId}/queue`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation }),
      });
      if (!response.ok) throw new Error("Could not update the queue. Please try again.");

      if (operation === "start_consultation") {
        router.push(`/consultations/${item.consultationId}`);
        return;
      }
      router.refresh();
    } catch (operationError) {
      setError(
        operationError instanceof Error ? operationError.message : "Could not update the queue. Please try again."
      );
    } finally {
      setPendingAppointmentId(null);
    }
  }

  async function sendIntake(item: AppointmentQueueItem) {
    setError(null);
    setIntakePreview(null);
    setIntakeNotice(null);
    setPendingAppointmentId(item.appointmentId);
    try {
      const response = await fetch(`/api/appointments/${item.appointmentId}/intake`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null) as {
        error?: string;
        deliveryStatus?: "sent" | "preview" | "pending";
        recipient?: string;
        message?: string;
        preview?: { intakeUrl: string };
      } | null;
      if (!response.ok) throw new Error(body?.error || "Could not send the intake link. Please try again.");
      if (body?.deliveryStatus === "preview" && body.preview) {
        setIntakePreview({ patientName: item.patientName, ...body.preview });
      } else if (body?.deliveryStatus === "pending") {
        setError(body.message || "Delivery confirmation is pending. Check the queue before resending.");
      } else if (body?.deliveryStatus === "sent") {
        setIntakeNotice(`Intake link sent to ${body.recipient || "the patient email"}.`);
      }
      router.refresh();
    } catch (deliveryError) {
      setError(deliveryError instanceof Error ? deliveryError.message : "Could not send the intake link. Please try again.");
    } finally {
      setPendingAppointmentId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="today-queue-heading">
      <div className={styles.todayPatientsHeader}>
        <div>
          <p className={styles.eyebrow}>Today&apos;s queue</p>
          <h2 id="today-queue-heading">Appointment operations</h2>
        </div>
        <label className={styles.patientSearch}>
          <Icon name="search" />
          <span className={styles.visuallyHidden}>Search today&apos;s queue by patient name</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search patient name"
          />
        </label>
      </div>

      <div className={styles.queueSummary} aria-label="Queue summary">
        <span><strong>{queue.summary.total}</strong> total</span>
        <span><strong>{queue.summary.waiting}</strong> waiting</span>
        <span><strong>{queue.summary.arrived}</strong> arrived</span>
        <span><strong>{queue.summary.intakePending}</strong> intake pending</span>
      </div>

      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {intakeNotice ? <div className={styles.savedNotice} role="status">{intakeNotice}</div> : null}
      {intakePreview ? (
        <div className={styles.intakePreviewBanner} role="status">
          <div>
            <strong>Local preview for {intakePreview.patientName}</strong>
            <span>Live delivery sends the link to the configured patient email. This preview is development-only.</span>
          </div>
          <label>Secure link<input readOnly value={intakePreview.intakeUrl} /></label>
          <button type="button" className={styles.secondaryButton} onClick={() => setIntakePreview(null)}>Close</button>
        </div>
      ) : null}

      {queue.items.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No appointments today</strong>
          <p>Booked appointments will appear here in scheduled-time order.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No matching patients</strong>
          <p>Try a different patient name.</p>
        </div>
      ) : (
        <ul className={styles.queueList}>
          {filteredItems.map((item) => {
            const status = operationalStatus(item);
            const actions = queueActions(item, role);
            const busy = pendingAppointmentId === item.appointmentId;
            const intakeLabel = item.intakeStatus === "submitted"
              ? { label: "Intake submitted", tone: "success" }
              : item.intakeStatus === "in_progress"
                ? { label: "Intake in progress", tone: "info" }
                : item.intakeAccessStatus === "sent"
                  ? { label: "Intake sent", tone: "info" }
                  : item.intakeAccessStatus === "pending"
                    ? { label: "Delivery pending", tone: "warning" }
                    : item.intakeAccessStatus === "expired"
                      ? { label: "Intake link expired", tone: "warning" }
                      : item.intakeAccessStatus === "locked"
                        ? { label: "Intake locked", tone: "danger" }
                        : item.intakeAccessStatus === "failed"
                          ? { label: "Delivery failed", tone: "danger" }
                          : item.intakeAccessStatus === "invalidated"
                            ? { label: "Intake link invalidated", tone: "warning" }
                            : { label: "Intake pending", tone: "warning" };
            const documentLabel = item.documentStatus === "none"
              ? { label: "No documents", tone: "neutral" }
              : item.documentStatus === "needs_review"
                ? { label: `${item.documentCount} · Needs Review`, tone: "danger" }
                : item.documentStatus === "processing"
                  ? { label: `${item.documentCount} · Processing`, tone: "warning" }
                  : item.documentStatus === "processed"
                    ? { label: `${item.documentCount} · Processed`, tone: "success" }
                    : { label: `${item.documentCount} · Uploaded`, tone: "info" };
            return (
              <li key={item.appointmentId} className={styles.queueRow}>
                <span className={styles.avatar}>{initials(item.patientName)}</span>
                <div className={styles.queueIdentity}>
                  <strong>{item.patientName}</strong>
                  <span>{appointmentTime(item.scheduledAt)} · {item.visitType === "new" ? "New patient" : "Follow-up"}</span>
                </div>
                <div className={styles.queueReadiness} aria-label="Operational readiness">
                  <span className={styles.statusBadge} data-tone={status.tone}>{status.label}</span>
                  <span className={styles.statusBadge} data-tone={intakeLabel.tone}>{intakeLabel.label}</span>
                  <span className={styles.statusBadge} data-tone={documentLabel.tone}>{documentLabel.label}</span>
                </div>
                <div className={styles.queueActions}>
                  {item.appointmentStatus === "scheduled" && item.intakeStatus !== "submitted" ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={busy || item.intakeAccessStatus === "pending"}
                      onClick={() => void sendIntake(item)}
                    >
                      {busy
                        ? "Sending…"
                        : item.intakeAccessStatus === "pending"
                          ? "Awaiting delivery"
                          : item.intakeAccessStatus !== "not_sent"
                            ? "Resend intake"
                            : "Send link"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setDocumentAppointmentId((current) => current === item.appointmentId ? null : item.appointmentId)}
                  >
                    {documentAppointmentId === item.appointmentId ? "Close documents" : "Documents"}
                  </button>
                  {actions.map((action) => (
                    <button
                      key={action.operation}
                      type="button"
                      className={action.primary ? styles.primaryButton : styles.secondaryButton}
                      disabled={busy}
                      onClick={() => void performOperation(item, action.operation)}
                    >
                      {busy ? "Updating…" : action.label}
                    </button>
                  ))}
                  {role === "doctor" && item.operationalStatus === "in_consultation" ? (
                    <Link className={styles.primaryButton} href={`/consultations/${item.consultationId}`}>
                      Open consultation
                    </Link>
                  ) : null}
                </div>
                {documentAppointmentId === item.appointmentId ? (
                  <div className={styles.queueDocumentPanel}>
                    <DocumentManager
                      mode="staff"
                      consultationId={item.consultationId}
                      canReviewExtraction={role === "doctor"}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.queuePhaseNote}>
        Intake and document preparation are optional and never block arrival or consultation.
      </p>
    </section>
  );
}
