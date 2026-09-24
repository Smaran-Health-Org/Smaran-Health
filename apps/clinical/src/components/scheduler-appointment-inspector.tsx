"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SendPatientPortalLink } from "@/components/send-patient-portal-link";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";
import type { ClinicDoctor } from "@/lib/db/clinics";
import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";
import type { SessionContext } from "@/types";
import { optionalDurationOverride } from "@/lib/scheduler/workspace-payloads";
import { inspectorActions, inspectorOriginLabel, inspectorQueueLabel } from "@/lib/scheduler/inspector-view-model";

type Conflict = { fingerprint: string; kind?: string; unresolvedDuration?: boolean };
type Issue = { code?: string; conflicts?: Conflict[]; warning?: Conflict };
type Action = "reschedule" | "reassign" | "cancel" | "no_show" | "rebook";
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function key() { return crypto.randomUUID(); }
function errorMessage(payload: unknown, fallback: string): string { return typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : fallback; }

export function AppointmentInspector({ appointment, doctors, role, onRefresh }: {
  appointment: SchedulerAppointmentSummary;
  doctors: ClinicDoctor[];
  role: SessionContext["role"];
  onRefresh: (message: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState(day.format(new Date(appointment.scheduledAt)));
  const [startTime, setStartTime] = useState(time.format(new Date(appointment.scheduledAt)));
  const [duration, setDuration] = useState(appointment.durationMinutes === null ? "" : String(appointment.durationMinutes));
  const [doctorId, setDoctorId] = useState(appointment.doctorId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [futureWarning, setFutureWarning] = useState<Conflict | null>(null);
  const [futureAcknowledged, setFutureAcknowledged] = useState(false);
  const keyRef = useRef(key());
  const router = useRouter();
  const eligibility = inspectorActions(appointment, role);
  const isToday = day.format(new Date(appointment.scheduledAt)) === day.format(new Date());

  function resetCommand() {
    keyRef.current = key();
    setConflicts([]); setAcknowledged(false); setFutureWarning(null); setFutureAcknowledged(false); setError(null);
  }
  function chooseAction(next: Action) { resetCommand(); setAction(next); }
  function edit(update: () => void) { resetCommand(); update(); }

  async function mutate(next: Action) {
    if (next === "reschedule" && appointment.durationState === "unknown") { setError("Confirm the historical duration before rescheduling."); return; }
    if (next === "reschedule" && optionalDurationOverride(duration) === undefined) { setError("A known duration from 5 to 60 minutes is required."); return; }
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        action: next, expectedUpdatedAt: appointment.updatedAt, idempotencyKey: keyRef.current,
        conflictAcknowledgements: acknowledged ? conflicts.map((item) => ({ fingerprint: item.fingerprint })) : [],
        futureCapAcknowledgement: futureAcknowledged && futureWarning ? { fingerprint: futureWarning.fingerprint } : undefined,
      };
      if (next === "reschedule" || next === "rebook") {
        body.scheduledAt = `${date}T${startTime}:00+05:30`;
        const minutes = optionalDurationOverride(duration);
        if (minutes !== undefined) body.durationMinutes = minutes;
      }
      if (next === "reassign") body.doctorId = doctorId;
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as { details?: Issue; error?: string } | null;
      if (!response.ok) {
        const issue = payload?.details;
        if (issue?.code === "stale_write") {
          resetCommand(); setAction(null);
          onRefresh("This appointment changed. Review the latest details before trying again.");
          return;
        }
        if (issue?.code === "conflict_acknowledgement_required" || issue?.code === "conflict_set_changed") {
          setConflicts(issue.conflicts ?? []); setAcknowledged(false);
          throw new Error("Review the current scheduling conflicts before continuing.");
        }
        if (issue?.code === "future_cap_acknowledgement_required") {
          setFutureWarning(issue.warning ?? null); setFutureAcknowledged(false);
          throw new Error("Review the future appointment warning before continuing.");
        }
        if (issue?.code === "target_duration_remediation_required") throw new Error("Confirm the historical duration before rescheduling.");
        throw new Error(payload?.error ?? "This action is no longer available.");
      }
      resetCommand(); setAction(null);
      onRefresh(`Appointment ${next.replaceAll("_", " ")} saved.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not change the appointment."); }
    finally { setBusy(false); }
  }

  async function remediate() {
    const minutes = optionalDurationOverride(duration);
    if (minutes === undefined) { setError("Enter a whole-number duration from 5 to 60 minutes."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/scheduler/appointments/${appointment.id}/remediate-duration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationMinutes: minutes }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), "Could not update duration."));
      onRefresh("Duration confirmed.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update duration."); }
    finally { setBusy(false); }
  }

  async function queue(operation: "mark_arrived" | "mark_waiting") {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/queue`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), "This Queue action is no longer available."));
      onRefresh(operation === "mark_arrived" ? "Patient marked arrived." : "Patient marked waiting.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update Queue state."); }
    finally { setBusy(false); }
  }

  // Operational check-in straight from the schedule, for a patient who arrives early.
  async function checkIn() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/queue`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "check_in" }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), "Check-in is no longer available for this appointment."));
      onRefresh("Patient checked in and added to the waiting queue.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not check the patient in."); }
    finally { setBusy(false); }
  }

  // Doctor-only: open the encounter from the schedule. The server returns the
  // canonical encounter id, so the doctor lands in the existing workflow.
  async function startConsultation() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/queue`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "start_consultation" }) });
      const payload = await response.json().catch(() => null) as { consultationId?: string } | null;
      if (!response.ok || !payload?.consultationId) throw new Error(errorMessage(payload, "The consultation could not be started."));
      router.push(`/consultations/${payload.consultationId}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The consultation could not be started."); setBusy(false); }
  }

  return <div className={styles.schedulerSideBody}>
    <div className={styles.schedulerInspectorIdentity}><strong>{appointment.patientName}</strong><span>{appointment.patientPhone ?? "Phone not recorded"}</span></div>
    {eligibility.startConsultation || eligibility.checkIn ? <section className={styles.schedulerVisitActions} aria-label="Start this visit">
      <div>
        <h3>Start this visit</h3>
        <p>{appointment.encounterOperationalStatus === "in_consultation" ? "This consultation is already in progress." : isToday ? "For a patient who arrived early, or when the doctor is free." : "This appointment is not today. Starting it now still opens the same encounter."}</p>
      </div>
      <div className={styles.schedulerVisitActionsRow}>
        {eligibility.startConsultation ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void startConsultation()}><Icon name="clipboard" /> {appointment.encounterOperationalStatus === "in_consultation" ? "Open consultation" : "Start consultation"}</button> : null}
        {eligibility.checkIn ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void checkIn()}>Check in patient</button> : null}
      </div>
    </section> : null}
    <section className={styles.schedulerInspectorSection} aria-label="Appointment timing">
      <h3>Appointment</h3>
      <dl className={styles.schedulerInspectorFacts}>
        <div><dt>Date and time</dt><dd>{day.format(new Date(appointment.scheduledAt))} · {time.format(new Date(appointment.scheduledAt))}</dd></div>
        <div><dt>Duration</dt><dd>{appointment.durationMinutes === null ? "Duration unknown" : `${appointment.durationMinutes} minutes`}</dd></div>
        <div><dt>Doctor</dt><dd>{appointment.doctorName}</dd></div>
        <div><dt>Visit type</dt><dd>{appointment.appointmentTypeName ?? "Type not recorded"}</dd></div>
        <div><dt>Booked via</dt><dd>{inspectorOriginLabel(appointment.origin)}</dd></div>
      </dl>
    </section>
    <section className={styles.schedulerInspectorSection} aria-label="Appointment lifecycle"><h3>Lifecycle</h3><p>{appointment.status === "no_show" ? "No-show" : appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}</p></section>
    <section className={styles.schedulerInspectorSection} aria-label="Arrival and Queue"><h3>Arrival and Queue</h3><p>{inspectorQueueLabel(appointment.encounterOperationalStatus)}</p></section>
    <section className={styles.schedulerInspectorSection} aria-label="Preparation"><h3>Preparation</h3>
      <p>{appointment.intakeStatus === "submitted" ? "Intake ready" : "Intake pending"}</p>
      <p>{appointment.documentStatus === "ready" ? "Documents ready" : appointment.documentStatus === "needs_review" ? "Documents to review" : "No documents recorded"}</p>
    </section>
    {appointment.durationState === "unknown" ? <section className={styles.schedulerInspectorSection} aria-label="Scheduling attention"><h3>Attention</h3><p>Duration unknown. Confirm the historical duration before rescheduling.</p>
      {eligibility.remediate ? <><label className={styles.formField}><span>Known duration in minutes</span><input type="number" min="5" max="60" value={duration} onChange={(event) => setDuration(event.target.value)} /></label><button type="button" className={styles.secondaryButton} disabled={busy || optionalDurationOverride(duration) === undefined} onClick={() => void remediate()}>Confirm duration</button></> : null}
    </section> : null}
    <section className={styles.schedulerInspectorSection} aria-label="Appointment actions"><h3>Actions</h3>
      {eligibility.sendLink ? <div className={styles.schedulerSideActions}>
        <SendPatientPortalLink patientId={appointment.patientId} label="Send Patient Link" />
        {eligibility.reschedule ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => chooseAction("reschedule")}>Reschedule</button> : null}
        {eligibility.reassign ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => chooseAction("reassign")}>Reassign doctor</button> : null}
        {eligibility.cancel ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => chooseAction("cancel")}>Cancel</button> : null}
        {eligibility.noShow ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => chooseAction("no_show")}>Mark no-show</button> : null}
        {eligibility.markArrived ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void queue("mark_arrived")}>Mark arrived</button> : null}
        {eligibility.markWaiting ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void queue("mark_waiting")}>Mark waiting</button> : null}
      </div> : eligibility.rebook ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => chooseAction("rebook")}>Rebook</button> : null}
      <a href={role === "doctor" ? `/patients/${appointment.patientId}` : `/desk/patients/${appointment.patientId}`}>View patient</a>
    </section>
    {action ? <section className={styles.schedulerInlineAction} aria-label={`${action.replaceAll("_", " ")} action`}>
      <h3>{action.replaceAll("_", " ")}</h3>
      {(action === "reschedule" || action === "rebook") ? <div className={styles.formGrid}>
        <label className={styles.formField}><span>Date</span><input type="date" value={date} onChange={(event) => edit(() => setDate(event.target.value))} /></label>
        <label className={styles.formField}><span>Time</span><input type="time" value={startTime} onChange={(event) => edit(() => setStartTime(event.target.value))} /></label>
        {appointment.durationState === "unknown" && action === "rebook" ? <p>Current server default will be used. The unknown historical duration is not sent.</p> : <label className={styles.formField}><span>Duration</span><input type="number" min="5" max="60" value={duration} onChange={(event) => edit(() => setDuration(event.target.value))} /></label>}
      </div> : null}
      {action === "reassign" ? <label className={styles.formField}><span>Target doctor</span><select value={doctorId} onChange={(event) => edit(() => setDoctorId(event.target.value))}>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label> : null}
      {conflicts.length ? <div className={styles.schedulerConflictReview}><strong>Scheduling conflicts</strong><ul>{conflicts.map((item) => <li key={item.fingerprint}>{(item.kind ?? "conflict").replaceAll("_", " ")}{item.unresolvedDuration ? " (unknown duration)" : ""}</li>)}</ul><label className={styles.reviewCheck}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I reviewed these exact current warnings and deliberately want to continue.</label></div> : null}
      {futureWarning ? <label className={styles.reviewCheck}><input type="checkbox" checked={futureAcknowledged} onChange={(event) => setFutureAcknowledged(event.target.checked)} /> I reviewed the patient’s future appointment cap warning and want to continue.</label> : null}
      <p>Changes are checked by Scheduler at save time.</p>
      <div className={styles.schedulerSideActions}><button type="button" className={styles.primaryButton} disabled={busy || (action === "reschedule" && optionalDurationOverride(duration) === undefined) || (conflicts.length > 0 && !acknowledged) || Boolean(futureWarning && !futureAcknowledged)} onClick={() => void mutate(action)}>{busy ? "Saving…" : `Confirm ${action.replaceAll("_", " ")}`}</button><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { resetCommand(); setAction(null); }}>Back</button></div>
    </section> : null}
    {error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}
  </div>;
}
