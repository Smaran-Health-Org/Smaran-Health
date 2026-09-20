"use client";

import { useEffect, useRef, useState } from "react";
import { SendPatientPortalLink } from "@/components/send-patient-portal-link";
import styles from "@/components/clinical.module.css";
import type { ClinicDoctor } from "@/lib/db/clinics";
import { CalendarRequestGate } from "@/lib/scheduler/calendar-request";
import { bookingSemanticIdentity, canPreviewBooking, displayedBookingDuration, hasValidDurationOverride, optionalDurationOverride, selectedDoctorTypeId } from "@/lib/scheduler/workspace-payloads";
import type { SchedulerPanel } from "@/lib/scheduler/panel-state";

type Prefill = Extract<SchedulerPanel, { kind: "booking" }>["prefill"];
type BookingPatient = NonNullable<Prefill["patient"]>;
type BookingType = { id: string; name: string; defaultDurationMinutes: number | null; resolvedDurationMinutes: number };
type BookingOptions = { effectiveIntervalMinutes: number; effectiveDefaultDurationMinutes: number; appointmentTypes: BookingType[] };
type Conflict = { fingerprint: string; kind?: string; unresolvedDuration?: boolean };
type ApiIssue = { code?: string; conflicts?: Conflict[]; warning?: Conflict };
type Preview = { available: boolean; conflicts?: string[] };

function atLocal(date: string, time: string): string { return `${date}T${time}:00+05:30`; }
function localDate(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function SchedulerBookingPanel({ doctors, prefill, onBooked, onViewAppointment }: {
  doctors: ClinicDoctor[]; prefill: Prefill; onBooked: (id: string) => void; onViewAppointment: (id: string) => void;
}) {
  const [patient, setPatient] = useState<BookingPatient | null>(prefill.patient ?? null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientMatches, setPatientMatches] = useState<BookingPatient[]>([]);
  const [searchError, setSearchError] = useState(false);
  const [newPatient, setNewPatient] = useState({ fullName: "", phone: "", email: "" });
  const [duplicates, setDuplicates] = useState<BookingPatient[]>([]);
  const [distinct, setDistinct] = useState(false);
  const [doctorId, setDoctorId] = useState(prefill.doctorId ?? doctors[0]?.id ?? "");
  const [date, setDate] = useState(prefill.date ?? localDate());
  const [time, setTime] = useState(prefill.time ?? "09:00");
  const [typeId, setTypeId] = useState("");
  const [durationOverride, setDurationOverride] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [options, setOptions] = useState<{ doctorId: string; value: BookingOptions } | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "checking" | "unavailable">("idle");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [futureWarning, setFutureWarning] = useState<Conflict | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [futureAcknowledged, setFutureAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [booked, setBooked] = useState<{ appointmentId: string; patientId: string } | null>(null);
  const keyRef = useRef(crypto.randomUUID());
  const previewGate = useRef(new CalendarRequestGate());
  const searchGate = useRef(new CalendarRequestGate());
  const patientInput = useRef<HTMLInputElement>(null);

  const currentOptions = options?.doctorId === doctorId ? options.value : null;
  const resolvedDuration = currentOptions ? displayedBookingDuration({ typeId, appointmentTypes: currentOptions.appointmentTypes, effectiveDefaultDurationMinutes: currentOptions.effectiveDefaultDurationMinutes }) : null;
  const selectedDuration = optionalDurationOverride(durationOverride) ?? resolvedDuration;
  const semantic = bookingSemanticIdentity({ patientId: patient?.id, doctorId, date, time, durationOverride, typeId, staffNote });
  const previewable = Boolean(currentOptions) && canPreviewBooking({ patientId: patient?.id, doctorId, date, time, duration: selectedDuration, validOverride: hasValidDurationOverride(durationOverride) });

  useEffect(() => { const previewRequests = previewGate.current; const searchRequests = searchGate.current; patientInput.current?.focus(); return () => { previewRequests.cancel(); searchRequests.cancel(); }; }, []);
  function invalidate() {
    previewGate.current.cancel(); setPreview(null); setPreviewState("idle");
    setConflicts([]); setFutureWarning(null); setAcknowledged(false); setFutureAcknowledged(false);
    setError(null); keyRef.current = crypto.randomUUID();
  }
  useEffect(() => {
    if (!doctorId) return;
    const controller = new AbortController();
    void fetch(`/api/scheduler/booking-options?doctorId=${encodeURIComponent(doctorId)}`, { signal: controller.signal })
      .then(async (response) => { const payload = await response.json().catch(() => null) as { data?: BookingOptions } | null; if (!response.ok || !payload?.data || !Array.isArray(payload.data.appointmentTypes)) throw new Error("Booking options unavailable"); return payload.data; })
      .then((value) => { if (!controller.signal.aborted) { setOptions({ doctorId, value }); setOptionsError(false); setTypeId((current) => selectedDoctorTypeId(current, value.appointmentTypes.map((type) => type.id))); } })
      .catch(() => { if (!controller.signal.aborted) { setOptions(null); setOptionsError(true); } });
    return () => controller.abort();
  }, [doctorId, optionsAttempt]);

  useEffect(() => {
    if (patientQuery.trim().length < 2) return;
    const gate = searchGate.current;
    const request = gate.start();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/patients?search=${encodeURIComponent(patientQuery.trim())}&page=1&pageSize=10`, { signal: request.signal });
        const payload = await response.json().catch(() => null) as { data?: BookingPatient[] } | null;
        if (!response.ok || !Array.isArray(payload?.data)) throw new Error("Search unavailable");
        if (request.isCurrent()) setPatientMatches(payload.data);
      } catch { if (request.isCurrent()) setSearchError(true); }
    }, 250);
    return () => { window.clearTimeout(timer); gate.cancel(); };
  }, [patientQuery]);

  useEffect(() => {
    const gate = previewGate.current;
    if (!previewable || booked) { gate.cancel(); return; }
    const request = gate.start();
    const timer = window.setTimeout(async () => {
      if (!request.isCurrent()) return;
      setPreviewState("checking");
      try {
        const response = await fetch("/api/scheduler/availability", { method: "POST", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: patient!.id, doctorId, localDate: date, candidateStart: atLocal(date, time), durationMinutes: selectedDuration, appointmentTypeId: typeId || undefined }) });
        const payload = await response.json().catch(() => null) as Preview | null;
        if (!response.ok || typeof payload?.available !== "boolean") throw new Error("Preview unavailable");
        if (request.isCurrent()) { setPreview(payload); setPreviewState("idle"); }
      } catch { if (request.isCurrent()) { setPreview(null); setPreviewState("unavailable"); } }
    }, 300);
    return () => { window.clearTimeout(timer); gate.cancel(); };
  }, [semantic, previewable, selectedDuration, booked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createPatient() {
    setCreating(true); setError(null);
    try {
      const response = await fetch("/api/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newPatient, email: newPatient.email || undefined, duplicateOverride: distinct ? "confirmed_distinct_patient" : undefined }) });
      const data = await response.json().catch(() => null) as (BookingPatient & { details?: { candidates?: BookingPatient[] }; error?: string }) | null;
      if (response.status === 409 && data?.details?.candidates) { setDuplicates(data.details.candidates); setDistinct(false); return; }
      if (!response.ok || !data?.id) throw new Error(data?.error || "Could not create patient.");
      invalidate(); searchGate.current.cancel(); setPatient(data); setDuplicates([]); setPatientQuery(""); setPatientMatches([]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create patient."); }
    finally { setCreating(false); }
  }

  async function save() {
    if (!patient) { setError("Choose an existing patient or create a patient first."); return; }
    if (!currentOptions) { setError("Load the selected doctor's booking options before booking."); return; }
    if (!previewable) { setError("Enter a valid date, exact start time and whole-number duration from 5 to 60 minutes."); return; }
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: patient.id, doctorId, scheduledAt: atLocal(date, time), ...(optionalDurationOverride(durationOverride) !== undefined ? { durationMinutes: optionalDurationOverride(durationOverride) } : {}), appointmentTypeId: typeId || undefined, staffNote: staffNote || undefined, idempotencyKey: keyRef.current, conflictAcknowledgements: acknowledged ? conflicts.map((item) => ({ fingerprint: item.fingerprint })) : [], futureCapAcknowledgement: futureAcknowledged && futureWarning ? { fingerprint: futureWarning.fingerprint } : undefined }) });
      const data = await response.json().catch(() => null) as { id?: string; details?: ApiIssue; error?: string } | null;
      if (!response.ok) {
        const issue = data?.details;
        if (issue?.code === "conflict_acknowledgement_required" || issue?.code === "conflict_set_changed") {
          setConflicts(issue.conflicts ?? []); setAcknowledged(false); setPreview(null); setPreviewState("idle");
          throw new Error("The schedule changed. Review the current conflicts, then explicitly acknowledge them.");
        }
        if (issue?.code === "future_cap_acknowledgement_required") { setFutureWarning(issue.warning ?? null); setFutureAcknowledged(false); throw new Error("Review the future appointment warning, then explicitly acknowledge it."); }
        throw new Error(data?.error || "Could not book the appointment.");
      }
      if (!data?.id) throw new Error("Appointment booking succeeded without an appointment identifier.");
      setBooked({ appointmentId: data.id, patientId: patient.id }); previewGate.current.cancel(); onBooked(data.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not book the appointment."); }
    finally { setBusy(false); }
  }

  if (booked) return <div className={styles.schedulerSideBody} role="status"><strong>Appointment booked</strong><p>The appointment is saved. Sending a Patient Portal link is a separate manual action.</p><div className={styles.schedulerSideActions}><button type="button" className={styles.primaryButton} onClick={() => onViewAppointment(booked.appointmentId)}>View appointment</button><SendPatientPortalLink patientId={booked.patientId} label="Send Patient Link" /></div></div>;
  const currentType = currentOptions?.appointmentTypes.find((type) => type.id === typeId);
  const doctor = doctors.find((item) => item.id === doctorId);
  return <div className={`${styles.schedulerSideBody} ${styles.schedulerBookingBody}`}>
    <section className={styles.schedulerBookingSection} aria-label="Patient">
      <h3>Patient</h3>
      {patient ? <div className={styles.schedulerSelectedPatient}><strong>{patient.fullName}</strong><button type="button" className={styles.secondaryButton} onClick={() => { invalidate(); setPatient(null); patientInput.current?.focus(); }}>Change</button></div> : null}
      <label className={styles.formField}><span>Find existing patient</span><input ref={patientInput} type="search" value={patientQuery} onChange={(event) => { searchGate.current.cancel(); setPatientQuery(event.target.value); setPatientMatches([]); setSearchError(false); }} placeholder="Name or phone" /></label>
      {searchError ? <p role="alert">Patient search unavailable. Try again.</p> : null}
      {patientMatches.map((match) => <button key={match.id} type="button" className={styles.schedulerPatientResult} onClick={() => { invalidate(); searchGate.current.cancel(); setPatient(match); setPatientQuery(""); setPatientMatches([]); }}><strong>{match.fullName}</strong><span>{match.phone ?? "Phone not recorded"}</span></button>)}
      <details className={styles.schedulerBookingMore}><summary>Create a new patient</summary><div className={styles.schedulerBookingFields}>
        <label className={styles.formField}><span>Full name</span><input value={newPatient.fullName} onChange={(event) => { setNewPatient({ ...newPatient, fullName: event.target.value }); setDistinct(false); setDuplicates([]); }} /></label>
        <label className={styles.formField}><span>Phone</span><input value={newPatient.phone} onChange={(event) => { setNewPatient({ ...newPatient, phone: event.target.value }); setDistinct(false); setDuplicates([]); }} /></label>
        <label className={styles.formField}><span>Email (optional, for link)</span><input type="email" value={newPatient.email} onChange={(event) => setNewPatient({ ...newPatient, email: event.target.value })} /></label>
        {duplicates.length ? <div className={styles.duplicateReview}><strong>Possible existing patient</strong>{duplicates.map((match) => <button key={match.id} type="button" className={styles.secondaryButton} onClick={() => { invalidate(); setPatient(match); setDuplicates([]); }}>{match.fullName} · {match.phone}</button>)}<label className={styles.reviewCheck}><input type="checkbox" checked={distinct} onChange={(event) => setDistinct(event.target.checked)} /> I reviewed these records and this is a different patient.</label></div> : null}
        <button type="button" className={styles.secondaryButton} onClick={() => void createPatient()} disabled={creating || !newPatient.fullName.trim() || !newPatient.phone.trim() || (duplicates.length > 0 && !distinct)}>{creating ? "Creating…" : "Create and select"}</button>
      </div></details>
    </section>
    <section className={styles.schedulerBookingSection} aria-label="Visit and doctor"><h3>Visit</h3>
      <label className={styles.formField}><span>Doctor</span><select value={doctorId} onChange={(event) => { invalidate(); setDoctorId(event.target.value); setOptions(null); setOptionsError(false); setTypeId(""); }}>{doctors.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
      {optionsError ? <p role="alert">Booking options unavailable. Booking is paused until current defaults load. <button type="button" className={styles.secondaryButton} onClick={() => { setOptionsError(false); setOptionsAttempt((value) => value + 1); }}>Retry</button></p> : null}
      <label className={styles.formField}><span>Appointment type</span><select value={typeId} disabled={!currentOptions} onChange={(event) => { invalidate(); setTypeId(event.target.value); }}><option value="">No type</option>{(currentOptions?.appointmentTypes ?? []).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
    </section>
    <section className={styles.schedulerBookingSection} aria-label="Date and time"><h3>Date and time</h3><div className={styles.schedulerBookingFields}>
      <label className={styles.formField}><span>Date</span><input type="date" value={date} onChange={(event) => { invalidate(); setDate(event.target.value); }} /></label>
      <label className={styles.formField}><span>Start time</span><input type="time" value={time} step="60" onChange={(event) => { invalidate(); setTime(event.target.value); }} /><small>Exact minutes are allowed, such as 09:07.</small></label>
    </div></section>
    <section className={styles.schedulerBookingSection} aria-label="Duration"><h3>Duration</h3><label className={styles.formField}><span>Duration (minutes)</span><input type="number" min="5" max="60" step="1" disabled={!currentOptions} value={durationOverride || (resolvedDuration?.toString() ?? "")} onChange={(event) => { invalidate(); setDurationOverride(event.target.value); }} /><small>Choose any whole number from 5 to 60 minutes, such as 5, 10, or 15.</small></label><p>{durationOverride.trim() ? "Appointment-specific duration" : currentType?.defaultDurationMinutes != null ? `Defaults to ${doctor?.fullName ?? "the doctor's"} ${currentType.name} visit setting` : `Defaults to ${doctor?.fullName ?? "the selected doctor"} setting`}</p>
      <details className={styles.schedulerBookingMore}><summary>More options</summary><div className={styles.schedulerBookingFields}><label className={styles.formField}><span>Staff note (optional)</span><input value={staffNote} maxLength={2000} onChange={(event) => { invalidate(); setStaffNote(event.target.value); }} /></label></div></details>
      {!hasValidDurationOverride(durationOverride) ? <p role="alert">Use a whole-number duration from 5 to 60 minutes.</p> : null}
    </section>
    <section className={styles.schedulerBookingSection} aria-label="Availability preview"><h3>Schedule check</h3>
      {!previewable ? <p>Choose a patient and valid visit details to check the schedule.</p> : conflicts.length ? <p role="status">Final save found current scheduling warnings. Review them below; save checks again.</p> : previewState === "checking" ? <p role="status">Checking schedule…</p> : previewState === "unavailable" ? <p role="status">Availability preview unavailable. Final save will still check the schedule.</p> : preview ? <p className={styles.schedulerPreview} data-warning={!preview.available} role="status">{preview.available ? "✓ No conflict found." : `Scheduling warning: ${(preview.conflicts ?? []).join(", ").replaceAll("_", " ") || "Review at final save"}.`} Final save checks again.</p> : <p role="status">Checking schedule…</p>}
      {conflicts.length ? <div className={styles.schedulerConflictReview} data-strong={conflicts.some((item) => ["working_availability", "leave", "blocked"].includes(item.kind ?? ""))}><strong>Current scheduling warnings</strong><ul>{conflicts.map((item) => <li key={item.fingerprint}>{(item.kind ?? "conflict").replaceAll("_", " ")}{item.unresolvedDuration ? " (includes an appointment with unknown duration)" : ""}</li>)}</ul><label className={styles.reviewCheck}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I reviewed these exact current warnings and deliberately want to continue.</label></div> : null}
      {futureWarning ? <label className={styles.reviewCheck}><input type="checkbox" checked={futureAcknowledged} onChange={(event) => setFutureAcknowledged(event.target.checked)} /> I reviewed the patient’s future appointment cap warning and want to continue.</label> : null}
    </section>
    {error ? <div className={styles.errorBanner} role="alert"><span>{error}</span></div> : null}
    <div className={styles.schedulerBookingActions}><button type="button" className={styles.primaryButton} onClick={() => void save()} disabled={!previewable || busy || (conflicts.length > 0 && !acknowledged) || Boolean(futureWarning && !futureAcknowledged)}>{busy ? "Booking…" : "Book appointment"}</button></div>
  </div>;
}
