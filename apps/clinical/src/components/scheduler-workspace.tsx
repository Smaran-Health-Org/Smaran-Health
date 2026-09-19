"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { SendPatientPortalLink } from "@/components/send-patient-portal-link";
import styles from "@/components/clinical.module.css";
import type { ClinicDoctor } from "@/lib/db/clinics";
import type { SchedulerAppointmentSummary, SchedulerCalendar, SchedulerPatientHistory } from "@/lib/db/scheduler-read";
import type { Patient, SessionContext } from "@/types";
import { CALENDAR_DAY_HEIGHT_PX, CALENDAR_DAY_MINUTES, CALENDAR_LABEL_MINUTES, calendarAppointmentGeometry, calendarAppointmentOverlapLayout, calendarLaneGeometry, calendarMinuteOffset } from "@/lib/scheduler/calendar-geometry";
import { CalendarRequestGate } from "@/lib/scheduler/calendar-request";
import { calendarAppointmentAccessibleLabel, calendarBookingMinute, calendarOperationalSummary, kolkataClock, visibleCalendarDoctors } from "@/lib/scheduler/calendar-view-model";
import { bookingSemanticIdentity, displayedBookingDuration, hasValidDurationOverride, optionalDurationOverride, selectedDoctorTypeId } from "@/lib/scheduler/workspace-payloads";

type Conflict = { fingerprint: string; kind?: string; unresolvedDuration?: boolean; [key: string]: unknown };
type ApiIssue = { code?: string; conflicts?: Conflict[]; warning?: Conflict; error?: string };
type BookingPatient = Pick<Patient, "id" | "fullName" | "phone" | "email">;
type BookingType = { id: string; name: string; defaultDurationMinutes: number | null; resolvedDurationMinutes: number };
type BookingOptions = { effectiveIntervalMinutes: number; effectiveDefaultDurationMinutes: number; appointmentTypes: BookingType[] };
type PatientSearchResult = { id: string; fullName: string; phone: string | null };
type Prefill = { doctorId?: string; date?: string; time?: string };

const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localDate(value = new Date()): string { return formatter.format(value); }
function localStart(date: string): string { return `${date}T00:00:00+05:30`; }
function addDays(date: string, days: number): string { const base = new Date(`${date}T00:00:00+05:30`); base.setUTCDate(base.getUTCDate() + days); return localDate(base); }
function atLocal(date: string, time: string): string { return `${date}T${time}:00+05:30`; }
function appointmentTime(value: string): string { return timeFormatter.format(new Date(value)); }
function appointmentDate(value: string): string { return localDate(new Date(value)); }
function safeError(payload: unknown, fallback: string): string { return typeof payload === "object" && payload && "error" in payload && typeof (payload as { error?: unknown }).error === "string" ? (payload as { error: string }).error : fallback; }
function randomKey(): string { return crypto.randomUUID(); }

export function SchedulerWorkspace({ initialDoctors, role }: { initialDoctors: ClinicDoctor[]; role: SessionContext["role"] }) {
  const [date, setDate] = useState(localDate());
  const [view, setView] = useState<"day" | "week">("day");
  const [doctorIds, setDoctorIds] = useState<string[]>(initialDoctors.map((doctor) => doctor.id));
  const [weekDoctorId, setWeekDoctorId] = useState(initialDoctors[0]?.id ?? "");
  const [calendar, setCalendar] = useState<SchedulerCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<Prefill | null>(null);
  const [selected, setSelected] = useState<SchedulerAppointmentSummary | null>(null);
  const [search, setSearch] = useState("");
  const [patientSearchResults, setPatientSearchResults] = useState<PatientSearchResult[]>([]);
  const [patientHistory, setPatientHistory] = useState<SchedulerPatientHistory | null>(null);
  const [historyPatient, setHistoryPatient] = useState<PatientSearchResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGate = useRef(new CalendarRequestGate());

  const endDate = view === "week" ? addDays(date, 7) : addDays(date, 1);
  const selectedDoctors = visibleCalendarDoctors(view, doctorIds, weekDoctorId);
  function invalidateCalendar() { requestGate.current.cancel(); setCalendar(null); setLoading(true); setError(null); }
  function changeDate(nextDate: string) { if (nextDate === date) return; invalidateCalendar(); setDate(nextDate); }
  function changeView(nextView: "day" | "week") { if (nextView === view) return; invalidateCalendar(); setView(nextView); }
  async function loadCalendar() {
    const request = requestGate.current.start();
    setLoading(true); setError(null);
    if (selectedDoctors.length === 0) { setCalendar(null); setLoading(false); return; }
    try {
      const params = new URLSearchParams({ startsAt: new Date(localStart(date)).toISOString(), endsAt: new Date(localStart(endDate)).toISOString() });
      selectedDoctors.forEach((doctorId) => params.append("doctorId", doctorId));
      const response = await fetch(`/api/scheduler/calendar?${params}`, { signal: request.signal });
      const payload = await response.json().catch(() => null);
      if (!request.isCurrent()) return;
      if (!response.ok) throw new Error(safeError(payload, "Could not load the Scheduler calendar."));
      setCalendar(payload as SchedulerCalendar);
    } catch (failure) {
      if (request.isCurrent()) setError(failure instanceof Error ? failure.message : "Could not load the Scheduler calendar.");
    } finally { if (request.isCurrent()) setLoading(false); }
  }
  useEffect(() => {
    const gate = requestGate.current;
    const timer = window.setTimeout(() => void loadCalendar(), 0);
    return () => { window.clearTimeout(timer); gate.cancel(); };
  }, [date, view, doctorIds.join(","), weekDoctorId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/scheduler/search?q=${encodeURIComponent(search.trim())}`, { signal: controller.signal });
        const payload = await response.json().catch(() => null) as { data?: PatientSearchResult[] } | null;
        if (response.ok && !controller.signal.aborted) setPatientSearchResults(payload?.data ?? []);
      } catch { /* A later search supersedes this request. */ }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search]);
  function toggleDoctor(id: string) { if (doctorIds.length === 1 && doctorIds.includes(id)) return; invalidateCalendar(); setDoctorIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  const days = view === "week" ? Array.from({ length: 7 }, (_, index) => addDays(date, index)) : [date];
  const summary = calendar ? calendarOperationalSummary(calendar.appointments) : null;
  return <>
    <header className={styles.schedulerHeader}>
      <div><h1>Appointments</h1><p>{view === "week" ? `${date} – ${addDays(date, 6)}` : date} · Asia/Kolkata</p></div>
      <button className={styles.primaryButton} onClick={() => setBooking({ doctorId: selectedDoctors[0], date, time: "09:00" })}><Icon name="plus" /> New appointment</button>
    </header>
    {!loading && !error && summary ? <div className={styles.schedulerSummary} aria-label="Visible appointment summary"><span><strong>{summary.appointments}</strong> Appointments</span><span><strong>{summary.intakePending}</strong> Intake pending</span></div> : null}
    <section className={styles.schedulerControls} aria-label="Scheduler controls">
      <div className={styles.schedulerDateControls}><button className={styles.secondaryButton} onClick={() => changeDate(addDays(date, view === "week" ? -7 : -1))} aria-label="Previous date"><Icon name="arrowLeft" /></button><button className={styles.secondaryButton} onClick={() => changeDate(localDate())}>Today</button><button className={styles.secondaryButton} onClick={() => changeDate(addDays(date, view === "week" ? 7 : 1))} aria-label="Next date"><Icon name="arrowRight" /></button><strong>{view === "week" ? `${date} – ${addDays(date, 6)}` : date}</strong></div>
      <div className={styles.schedulerToggle} role="group" aria-label="Calendar view"><button data-active={view === "day"} onClick={() => changeView("day")}>Day</button><button data-active={view === "week"} onClick={() => changeView("week")}>Week</button></div>
      {view === "week" ? <label className={styles.schedulerProviderSelect}>Doctor <select aria-label="Week doctor" value={weekDoctorId} onChange={(event) => { if (event.target.value !== weekDoctorId) { invalidateCalendar(); setWeekDoctorId(event.target.value); } }}>{initialDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label> : <details className={styles.schedulerProviderFilter}><summary>{doctorIds.length === initialDoctors.length ? "All doctors" : `${doctorIds.length} doctors`}</summary><div>{initialDoctors.map((doctor) => <label key={doctor.id}><input type="checkbox" checked={doctorIds.includes(doctor.id)} onChange={() => toggleDoctor(doctor.id)} /> {doctor.fullName}</label>)}</div></details>}
      <label className={`${styles.searchField} ${styles.schedulerToolbarSearch}`}><Icon name="search" /><input value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value.trim().length < 2) { setPatientSearchResults([]); setPatientHistory(null); setHistoryPatient(null); } }} placeholder="Search patient" aria-label="Search patient scheduling history" /></label>
      <span className={styles.schedulerRulerBadge}>5 min ruler</span>
      <a className={styles.schedulerSettingsLink} href="/scheduler/settings">Settings</a>
    </section>
    {patientSearchResults.length ? <section className={styles.schedulerSearchResults} aria-label="Patient search results">{patientSearchResults.map((patient) => <button key={patient.id} onClick={() => void loadPatientHistory(patient)}><strong>{patient.fullName}</strong><span>{patient.phone ?? "Phone not recorded"}</span></button>)}</section> : null}
    {historyPatient ? <section className={styles.schedulerSearchResults} aria-label="Selected patient scheduling history"><strong>{historyPatient.fullName} — scheduling history</strong><PatientHistoryGroup title="Upcoming" empty="No upcoming appointments" appointments={patientHistory?.upcoming ?? []} onSelect={setSelected} /><PatientHistoryGroup title="Past" empty="No past appointments" appointments={patientHistory?.past ?? []} onSelect={setSelected} /></section> : null}
    {error ? <div className={styles.errorBanner} role="alert"><strong>Calendar unavailable.</strong><span>{error}</span><button className={styles.secondaryButton} onClick={() => void loadCalendar()}>Try again</button></div> : null}
    {notice ? <div className={styles.schedulerPreview} role="status">{notice}</div> : null}
    {loading ? <div className={styles.schedulerState} role="status">Loading appointments…</div> : null}
    {!loading && !error && calendar && calendar.appointments.length === 0 ? <div className={styles.schedulerEmptyNote}>No appointments in this range. Calendar space has not been checked for availability.</div> : null}
    {!loading && !error && calendar ? <SchedulerCalendarView calendar={calendar} days={days} doctorIds={selectedDoctors} onBook={setBooking} onSelect={setSelected} /> : null}
    {booking ? <BookingDialog doctors={calendar?.doctors ?? initialDoctors} prefill={booking} onClose={() => setBooking(null)} onBooked={() => void loadCalendar()} /> : null}
    {selected ? <AppointmentDialog appointment={selected} doctors={calendar?.doctors ?? initialDoctors} role={role} onClose={() => setSelected(null)} onChanged={(message) => { setSelected(null); setNotice(message ?? null); void loadCalendar(); }} /> : null}
  </>;

  async function loadPatientHistory(patient: PatientSearchResult) {
    const response = await fetch(`/api/scheduler/search?patientId=${encodeURIComponent(patient.id)}&limit=20`);
    const payload = await response.json().catch(() => null) as { data?: SchedulerPatientHistory } | null;
    if (response.ok) { setHistoryPatient(patient); setPatientHistory(payload?.data ?? { upcoming: [], past: [] }); }
  }
}

function PatientHistoryGroup({ title, empty, appointments, onSelect }: { title: string; empty: string; appointments: SchedulerAppointmentSummary[]; onSelect: (appointment: SchedulerAppointmentSummary) => void }) {
  return <div className={styles.schedulerHistoryGroup}><strong>{title}</strong>{appointments.length ? appointments.map((appointment) => <button key={appointment.id} onClick={() => onSelect(appointment)}><strong>{appointmentDate(appointment.scheduledAt)} · {appointmentTime(appointment.scheduledAt)}</strong><span>{appointment.doctorName} · {appointment.status.replace("_", " ")} · {appointment.durationState === "unknown" ? "duration unknown" : `${appointment.durationMinutes} min`}</span></button>) : <span>{empty}</span>}</div>;
}

function SchedulerCalendarView({ calendar, days, doctorIds, onBook, onSelect }: { calendar: SchedulerCalendar; days: string[]; doctorIds: string[]; onBook: (prefill: Prefill) => void; onSelect: (appointment: SchedulerAppointmentSummary) => void }) {
  const doctors = calendar.doctors.filter((doctor) => doctorIds.includes(doctor.id));
  const columns = days.flatMap((day) => doctors.map((doctor) => ({ day, doctor })));
  const scrollRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 15000); return () => window.clearInterval(timer); }, []);
  const clock = kolkataClock(now);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const appointmentMinutes = calendar.appointments.filter((item) => days.includes(appointmentDate(item.scheduledAt)) && doctorIds.includes(item.doctorId)).map((item) => {
      const [hour, minute] = appointmentTime(item.scheduledAt).split(":").map(Number);
      return (hour % 24) * 60 + minute;
    });
    const focusMinute = appointmentMinutes.length ? Math.min(...appointmentMinutes) : (days.includes(clock.date) ? clock.minute : 9 * 60);
    viewport.scrollTop = Math.max(0, calendarMinuteOffset(Math.max(0, focusMinute - 25)) - 60);
  }, [calendar, days.join(","), doctorIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = Array.from({ length: CALENDAR_DAY_MINUTES / CALENDAR_LABEL_MINUTES }, (_, index) => index * CALENDAR_LABEL_MINUTES);
  function chooseTime(day: string, doctorId: string, minute: number) {
    onBook({ doctorId, date: day, time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}` });
  }
  return <section ref={scrollRef} className={styles.schedulerCalendar} style={{ "--scheduler-columns": columns.length } as CSSProperties} aria-label="Appointment calendar">
    <div className={styles.schedulerGridHeader}><span>IST</span>{columns.map(({ day, doctor }) => <strong key={`${day}-${doctor.id}`}><span>{days.length > 1 ? `${day.slice(5)} · ` : ""}{doctor.fullName}</span><small>{calendar.appointments.filter((item) => item.doctorId === doctor.id && appointmentDate(item.scheduledAt) === day && item.status === "scheduled").length} appointments</small></strong>)}</div>
    <div className={styles.schedulerTimeline} style={{ height: CALENDAR_DAY_HEIGHT_PX }}>
      <div className={styles.schedulerTimeRuler}>{labels.map((minute) => <time key={minute} dateTime={`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`} style={{ top: calendarMinuteOffset(minute) }}>{String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}</time>)}</div>
      {columns.map(({ day, doctor }) => {
        const dayAppointments = calendar.appointments.filter((item) => item.doctorId === doctor.id && appointmentDate(item.scheduledAt) === day);
        const starts = dayAppointments.map((appointment) => {
          const [hour, minute] = appointmentTime(appointment.scheduledAt).split(":").map(Number);
          return { id: appointment.id, startMinute: (hour % 24) * 60 + minute, durationMinutes: appointment.durationMinutes };
        });
        const lanes = new Map(calendarAppointmentOverlapLayout(starts).map((lane) => [lane.id, lane]));
        return <div className={styles.schedulerTimelineColumn} key={`${day}-${doctor.id}`}>
          <button className={styles.schedulerTimePicker} aria-label={`Choose a time for ${doctor.fullName} on ${day}; availability is checked when booking`} onClick={(event) => {
            const minute = calendarBookingMinute(event.detail, event.clientY - event.currentTarget.getBoundingClientRect().top, scrollRef.current?.scrollTop ?? 0);
            chooseTime(day, doctor.id, minute);
          }} />
          {dayAppointments.map((appointment, index) => {
            const startMinute = starts[index].startMinute;
            const geometry = calendarAppointmentGeometry({ startMinute, durationMinutes: appointment.durationMinutes });
            const lane = lanes.get(appointment.id);
            const lanePosition = calendarLaneGeometry(lane?.laneIndex ?? 0, lane?.laneCount ?? 1);
            const duration = appointment.durationMinutes;
            const compact = duration !== null && duration < 10;
            const small = duration !== null && duration < 15;
            const cue = appointment.intakeStatus === "submitted" ? "Intake ready" : appointment.documentStatus === "needs_review" ? "Documents to review" : null;
            return <button key={appointment.id} className={styles.schedulerAppointment} data-status={appointment.status} data-unknown={geometry.isUnknownDuration} data-size={compact ? "compact" : small ? "small" : "regular"} style={{ top: geometry.topPx, height: geometry.heightPx, ...lanePosition } as CSSProperties} onClick={() => onSelect(appointment)} aria-label={calendarAppointmentAccessibleLabel(appointment, appointmentTime(appointment.scheduledAt))} title={`${appointment.patientName} · ${appointmentTime(appointment.scheduledAt)} · ${duration === null ? "Duration unknown" : `${duration} min`}`}>
              {compact ? <span className={styles.schedulerCompactText}>{appointment.patientName} · {duration}m</span> : <><strong>{appointment.patientName}</strong>{duration === null ? <span>Duration unknown</span> : small ? (cue ? <small>{cue}</small> : null) : <span>{appointment.appointmentTypeName ?? "Appointment"} · {duration}m</span>}{duration !== null && duration >= 20 && cue ? <small>{cue}</small> : null}</>}
            </button>;
          })}
        </div>;
      })}
      {days.length === 1 && days[0] === clock.date ? <div className={styles.schedulerNowLine} style={{ top: calendarMinuteOffset(clock.minute) }} aria-label={`Current time ${clock.time}`}><span>NOW · {clock.time}</span></div> : null}
      {days.length > 1 && columns.map(({ day, doctor }, index) => day === clock.date ? <div key={`now-${day}-${doctor.id}`} className={styles.schedulerNowLine} data-column style={{ top: calendarMinuteOffset(clock.minute), left: `calc(${index * 100 / columns.length}% + ${64 * (1 - index / columns.length)}px)`, width: `calc(${100 / columns.length}% - ${64 / columns.length}px)`, right: "auto" }} aria-label={`Current time ${clock.time}`}><span>NOW · {clock.time}</span></div> : null)}
    </div>
    <p className={styles.schedulerGridHint}>5-minute visual ruler. Exact-minute starts are available in booking. Empty space does not indicate availability.</p>
  </section>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={dialogRef} className={styles.schedulerDialog} aria-labelledby="scheduler-dialog-title" onClose={onClose}><div className={styles.schedulerDialogHeader}><h2 id="scheduler-dialog-title">{title}</h2><button className={styles.secondaryButton} onClick={onClose} aria-label="Close dialog">Close</button></div>{children}</dialog>;
}

function BookingDialog({ doctors, prefill, onClose, onBooked }: { doctors: ClinicDoctor[]; prefill: Prefill; onClose: () => void; onBooked: () => void }) {
  const [patient, setPatient] = useState<BookingPatient | null>(null); const [patientQuery, setPatientQuery] = useState(""); const [patientMatches, setPatientMatches] = useState<BookingPatient[]>([]);
  const [newPatient, setNewPatient] = useState({ fullName: "", phone: "", email: "" }); const [duplicates, setDuplicates] = useState<BookingPatient[]>([]); const [distinct, setDistinct] = useState(false);
  const [doctorId, setDoctorId] = useState(prefill.doctorId ?? doctors[0]?.id ?? ""); const [date, setDate] = useState(prefill.date ?? localDate()); const [time, setTime] = useState(prefill.time ?? "09:00"); const [durationOverride, setDurationOverride] = useState(""); const [typeId, setTypeId] = useState(""); const [options, setOptions] = useState<BookingOptions | null>(null); const [staffNote, setStaffNote] = useState("");
  const [preview, setPreview] = useState<{ conflicts?: string[]; available?: boolean } | null>(null); const [conflicts, setConflicts] = useState<Conflict[]>([]); const [futureWarning, setFutureWarning] = useState<Conflict | null>(null); const [acknowledged, setAcknowledged] = useState(false); const [futureAcknowledged, setFutureAcknowledged] = useState(false); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [booked, setBooked] = useState<{ appointmentId: string; patientId: string } | null>(null); const keyRef = useRef(randomKey());
  const durationMinutes = optionalDurationOverride(durationOverride);
  const effectiveDuration = options ? displayedBookingDuration({ typeId, appointmentTypes: options.appointmentTypes, effectiveDefaultDurationMinutes: options.effectiveDefaultDurationMinutes }) : null;
  const semantic = bookingSemanticIdentity({ patientId: patient?.id, doctorId, date, time, durationOverride, typeId, staffNote });
  const semanticRef = useRef(semantic);
  useEffect(() => { const timer = window.setTimeout(() => { if (semanticRef.current === semantic) return; semanticRef.current = semantic; keyRef.current = randomKey(); setConflicts([]); setFutureWarning(null); setAcknowledged(false); setFutureAcknowledged(false); }, 0); return () => window.clearTimeout(timer); }, [semantic]);
  useEffect(() => { if (!doctorId) return; const controller = new AbortController(); void fetch(`/api/scheduler/booking-options?doctorId=${doctorId}`, { signal: controller.signal }).then((response) => response.json()).then((payload) => { if (controller.signal.aborted) return; const nextOptions = payload.data as BookingOptions | null; setOptions(nextOptions); setTypeId((current) => selectedDoctorTypeId(current, nextOptions?.appointmentTypes.map((type) => type.id) ?? [])); }).catch(() => { if (!controller.signal.aborted) setOptions(null); }); return () => controller.abort(); }, [doctorId]);
  useEffect(() => { if (patientQuery.trim().length < 2) return; const timer = window.setTimeout(async () => { const response = await fetch(`/api/patients?search=${encodeURIComponent(patientQuery)}&page=1&pageSize=10`); const payload = await response.json().catch(() => null) as { data?: BookingPatient[] } | null; if (response.ok) setPatientMatches(payload?.data ?? []); }, 250); return () => window.clearTimeout(timer); }, [patientQuery]);
  async function createPatient() { setError(null); const payload = { ...newPatient, email: newPatient.email || undefined, duplicateOverride: distinct ? "confirmed_distinct_patient" : undefined }; const response = await fetch("/api/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => null) as BookingPatient & { details?: { candidates?: BookingPatient[] }; error?: string }; if (response.status === 409 && data.details?.candidates) { setDuplicates(data.details.candidates); return; } if (!response.ok || !data.id) throw new Error(data.error || "Could not create patient."); setPatient(data); setDuplicates([]); }
  async function runPreview() { if (!patient || !doctorId || !options || !hasValidDurationOverride(durationOverride)) return; setError(null); const response = await fetch("/api/scheduler/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: patient.id, doctorId, localDate: date, candidateStart: atLocal(date, time), ...(durationMinutes !== undefined ? { durationMinutes } : {}), appointmentTypeId: typeId || undefined }) }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(safeError(data, "Could not preview availability.")); setPreview(data); }
  async function save() { if (!patient) { setError("Choose an existing patient or create a patient first."); return; } if (!options) { setError("Wait for the selected doctor's booking options to load."); return; } if (!hasValidDurationOverride(durationOverride)) { setError("Enter a whole-number duration from 5 to 60 minutes, or clear the override to use the current default."); return; } setBusy(true); setError(null); try { const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: patient.id, doctorId, scheduledAt: atLocal(date, time), ...(durationMinutes !== undefined ? { durationMinutes } : {}), appointmentTypeId: typeId || undefined, staffNote: staffNote || undefined, idempotencyKey: keyRef.current, conflictAcknowledgements: acknowledged ? conflicts.map((item) => ({ fingerprint: item.fingerprint })) : [], futureCapAcknowledgement: futureAcknowledged && futureWarning ? { fingerprint: futureWarning.fingerprint } : undefined }) }); const data = await response.json().catch(() => null) as { id?: string; details?: ApiIssue; error?: string }; if (!response.ok) { const issue = data.details; if (issue?.code === "conflict_acknowledgement_required" || issue?.code === "conflict_set_changed") { setConflicts(issue.conflicts ?? []); setAcknowledged(false); setFutureWarning(null); throw new Error("Review the current conflicts, then explicitly acknowledge them."); } if (issue?.code === "future_cap_acknowledgement_required") { setFutureWarning(issue.warning ?? null); setFutureAcknowledged(false); throw new Error("Review the future appointment warning, then explicitly acknowledge it."); } throw new Error(data.error || "Could not book the appointment."); } if (!data.id) throw new Error("Appointment booking succeeded without an appointment identifier."); setBooked({ appointmentId: data.id, patientId: patient.id }); onBooked(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not book the appointment."); } finally { setBusy(false); } }
  const invalidDurationOverride = !hasValidDurationOverride(durationOverride);
  if (booked) return <Dialog title="Appointment booked" onClose={onClose}><div className={styles.schedulerForm}><p>The appointment is saved. Sending a Patient Portal link is a separate manual action.</p><SendPatientPortalLink patientId={booked.patientId} label="Send Patient Link" /><div className={styles.schedulerDialogActions}><button className={styles.primaryButton} onClick={onClose}>Done</button></div></div></Dialog>;
  return <Dialog title="Book appointment" onClose={onClose}><div className={styles.schedulerForm}><section><label className={styles.formField}><span>Find patient</span><input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Name or phone" /></label>{patientMatches.map((match) => <button key={match.id} className={styles.schedulerPatientResult} onClick={() => { setPatient(match); setPatientQuery(""); setPatientMatches([]); }}><strong>{match.fullName}</strong><span>{match.phone ?? "Phone not recorded"}</span></button>)}{patient ? <p className={styles.schedulerSelectedPatient}>Selected: <strong>{patient.fullName}</strong></p> : null}</section><details><summary>Create a new patient</summary><div className={styles.formGrid}><label className={styles.formField}><span>Full name</span><input value={newPatient.fullName} onChange={(event) => { setNewPatient({ ...newPatient, fullName: event.target.value }); setDistinct(false); }} /></label><label className={styles.formField}><span>Phone</span><input value={newPatient.phone} onChange={(event) => { setNewPatient({ ...newPatient, phone: event.target.value }); setDistinct(false); }} /></label><label className={styles.formField}><span>Email (for link)</span><input type="email" value={newPatient.email} onChange={(event) => setNewPatient({ ...newPatient, email: event.target.value })} /></label></div>{duplicates.length ? <div className={styles.duplicateReview}><strong>Possible existing patient</strong>{duplicates.map((match) => <button key={match.id} className={styles.secondaryButton} onClick={() => { setPatient(match); setDuplicates([]); }}>{match.fullName} · {match.phone}</button>)}<label className={styles.reviewCheck}><input type="checkbox" checked={distinct} onChange={(event) => setDistinct(event.target.checked)} /> I reviewed these records and this is a different patient.</label></div> : null}<button className={styles.secondaryButton} onClick={() => void createPatient()} disabled={!newPatient.fullName || !newPatient.phone || (duplicates.length > 0 && !distinct)}>Create and select</button></details><div className={styles.formGrid}><label className={styles.formField}><span>Doctor</span><select value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setOptions(null); }}>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label><label className={styles.formField}><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className={styles.formField}><span>Start time</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} step="60" /><small>Exact minutes are allowed.</small></label><label className={styles.formField}><span>Current duration</span><output>{effectiveDuration === null ? "Loading current default…" : `${effectiveDuration} minutes (server-resolved default)`}</output><small>Changes with the selected type when no override is entered.</small></label><label className={styles.formField}><span>Duration override (optional)</span><input type="number" min="5" max="60" value={durationOverride} onChange={(event) => setDurationOverride(event.target.value)} /> <small>Leave blank to inherit; 5–60 whole minutes when set.</small></label><label className={styles.formField}><span>Appointment type (optional)</span><select value={typeId} onChange={(event) => setTypeId(event.target.value)}><option value="">No type</option>{(options?.appointmentTypes ?? []).map((type) => <option key={type.id} value={type.id}>{type.name}{type.defaultDurationMinutes ? ` (${type.defaultDurationMinutes} min default)` : ""}</option>)}</select></label><label className={`${styles.formField} ${styles.fieldFull}`}><span>Staff note (optional)</span><input value={staffNote} maxLength={2000} onChange={(event) => setStaffNote(event.target.value)} /></label></div><button className={styles.secondaryButton} onClick={() => void runPreview()} disabled={!patient || !options || busy || invalidDurationOverride}>Preview availability</button>{preview ? <p className={styles.schedulerPreview} data-warning={!preview.available}>Advisory preview: {preview.available ? "No conflict found." : `Warning: ${(preview.conflicts ?? []).join(", ").replaceAll("_", " ")}.`} Final save checks again.</p> : null}{conflicts.length ? <ConflictReview conflicts={conflicts} acknowledged={acknowledged} setAcknowledged={setAcknowledged} /> : null}{futureWarning ? <label className={styles.reviewCheck}><input type="checkbox" checked={futureAcknowledged} onChange={(event) => setFutureAcknowledged(event.target.checked)} /> I reviewed the patient’s future appointment cap warning and want to continue.</label> : null}{error ? <div className={styles.errorBanner} role="alert"><span>{error}</span></div> : null}<div className={styles.schedulerDialogActions}><button className={styles.primaryButton} onClick={() => void save()} disabled={!options || busy || invalidDurationOverride || (conflicts.length > 0 && !acknowledged) || Boolean(futureWarning && !futureAcknowledged)}>{busy ? "Booking…" : "Book"}</button></div></div></Dialog>;
}

function ConflictReview({ conflicts, acknowledged, setAcknowledged }: { conflicts: Conflict[]; acknowledged: boolean; setAcknowledged: (value: boolean) => void }) { const strong = conflicts.some((item) => ["working_availability", "leave", "blocked"].includes(item.kind ?? "")); return <div className={styles.schedulerConflictReview} data-strong={strong}><strong>{strong ? "Scheduling availability warning" : "Scheduling conflict"}</strong><ul>{conflicts.map((item) => <li key={item.fingerprint}>{(item.kind ?? "conflict").replaceAll("_", " ")}{item.unresolvedDuration ? " (includes an appointment with unknown duration)" : ""}</li>)}</ul><label className={styles.reviewCheck}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I reviewed these exact current warnings and deliberately want to continue.</label></div>; }

function AppointmentDialog({ appointment, doctors, role, onClose, onChanged }: { appointment: SchedulerAppointmentSummary; doctors: ClinicDoctor[]; role: SessionContext["role"]; onClose: () => void; onChanged: (message?: string) => void }) {
  const [action, setAction] = useState<"reschedule" | "reassign" | "cancel" | "no_show" | "rebook" | null>(null); const [date, setDate] = useState(appointmentDate(appointment.scheduledAt)); const [time, setTime] = useState(appointmentTime(appointment.scheduledAt)); const [duration, setDuration] = useState(appointment.durationMinutes === null ? "" : String(appointment.durationMinutes)); const [doctorId, setDoctorId] = useState(appointment.doctorId); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [conflicts, setConflicts] = useState<Conflict[]>([]); const [acknowledged, setAcknowledged] = useState(false); const [futureWarning, setFutureWarning] = useState<Conflict | null>(null); const [futureAcknowledged, setFutureAcknowledged] = useState(false); const keyRef = useRef(randomKey());
  function chooseAction(next: NonNullable<typeof action>) { keyRef.current = randomKey(); setConflicts([]); setAcknowledged(false); setFutureWarning(null); setFutureAcknowledged(false); setError(null); setAction(next); }
  async function mutate(next: NonNullable<typeof action>) { if (next === "reschedule" && appointment.durationState === "unknown") { setError("Confirm the historical duration before rescheduling. Scheduler authority will not invent one."); return; } if (next === "reschedule" && optionalDurationOverride(duration) === undefined) { setError("A known duration from 5 to 60 minutes is required to reschedule."); return; } setBusy(true); setError(null); try { const body: Record<string, unknown> = { action: next, expectedUpdatedAt: appointment.updatedAt, idempotencyKey: keyRef.current, conflictAcknowledgements: acknowledged ? conflicts.map((item) => ({ fingerprint: item.fingerprint })) : [], futureCapAcknowledgement: futureAcknowledged && futureWarning ? { fingerprint: futureWarning.fingerprint } : undefined }; if (next === "reschedule" || next === "rebook") { body.scheduledAt = atLocal(date, time); const mutationDuration = optionalDurationOverride(duration); if (mutationDuration !== undefined) body.durationMinutes = mutationDuration; } if (next === "reassign") body.doctorId = doctorId; const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json().catch(() => null) as { details?: ApiIssue; error?: string }; if (!response.ok) { if (data.details?.code === "stale_write") { onChanged("This appointment changed elsewhere. The calendar was refreshed; review it before trying again."); return; } if (data.details?.code === "conflict_acknowledgement_required" || data.details?.code === "conflict_set_changed") { setConflicts(data.details.conflicts ?? []); setAcknowledged(false); throw new Error("Review the current scheduling conflicts before continuing."); } if (data.details?.code === "future_cap_acknowledgement_required") { setFutureWarning(data.details.warning ?? null); setFutureAcknowledged(false); throw new Error("Review the future appointment warning before continuing."); } if (data.details?.code === "target_duration_remediation_required") throw new Error("Confirm the historical duration before rescheduling."); throw new Error(data.error || "This action is no longer available."); } onChanged(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not change the appointment."); } finally { setBusy(false); } }
  async function remediate() { const knownDuration = optionalDurationOverride(duration); if (knownDuration === undefined) { setError("Enter a whole-number duration from 5 to 60 minutes."); return; } setBusy(true); const response = await fetch(`/api/scheduler/appointments/${appointment.id}/remediate-duration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationMinutes: knownDuration }) }); if (!response.ok) setError(safeError(await response.json().catch(() => null), "Could not update duration.")); else onChanged(); setBusy(false); }
  function editCommand(update: () => void) { keyRef.current = randomKey(); setConflicts([]); setAcknowledged(false); setFutureWarning(null); setFutureAcknowledged(false); update(); }
  const remediationDurationValid = optionalDurationOverride(duration) !== undefined;
  return <Dialog title="Appointment" onClose={onClose}><div className={styles.schedulerForm}><dl className={styles.schedulerDetails}><div><dt>Patient</dt><dd>{appointment.patientName}<small>{appointment.patientPhone ?? "Phone not recorded"}</small></dd></div><div><dt>Doctor</dt><dd>{appointment.doctorName}</dd></div><div><dt>Scheduled</dt><dd>{appointmentDate(appointment.scheduledAt)} · {appointmentTime(appointment.scheduledAt)}</dd></div><div><dt>Duration</dt><dd>{appointment.durationState === "unknown" ? "Unknown — not estimated" : `${appointment.durationMinutes} minutes`}</dd></div><div><dt>Appointment status</dt><dd>{appointment.status.replace("_", " ")}</dd></div><div><dt>Preparation</dt><dd>Intake: {appointment.intakeStatus ?? "not started"}<small>Documents: {appointment.documentStatus.replace("_", " ")} · Encounter: {appointment.encounterOperationalStatus.replace("_", " ")}</small></dd></div></dl>{appointment.durationState === "unknown" ? <div className={styles.schedulerConflictReview} data-strong><strong>Historical duration needs confirmation</strong><p>Enter the known historical duration deliberately. No placeholder will be saved.</p><label className={styles.formField}><span>Known duration</span><input type="number" min="5" max="60" value={duration} onChange={(event) => setDuration(event.target.value)} /></label><button className={styles.secondaryButton} onClick={() => void remediate()} disabled={busy || !remediationDurationValid}>Confirm duration</button></div> : null}{appointment.status === "scheduled" ? <div className={styles.schedulerAppointmentActions}>{appointment.durationState === "unknown" ? <span>Rescheduling is available after duration confirmation.</span> : <button className={styles.secondaryButton} onClick={() => chooseAction("reschedule")}>Reschedule</button>}{role === "doctor" ? <button className={styles.secondaryButton} onClick={() => chooseAction("reassign")}>Reassign doctor</button> : null}<button className={styles.secondaryButton} onClick={() => chooseAction("cancel")}>Cancel</button><button className={styles.secondaryButton} onClick={() => chooseAction("no_show")}>Mark no-show</button></div> : (appointment.status === "cancelled" || appointment.status === "no_show") ? <button className={styles.primaryButton} onClick={() => chooseAction("rebook")}>Rebook</button> : null}<div className={styles.schedulerAppointmentActions}><SendPatientPortalLink patientId={appointment.patientId} label="Send Patient Link" /></div>{action ? <div className={styles.schedulerInlineAction}><strong>{action.replace("_", " ")}</strong>{(action === "reschedule" || action === "rebook") ? <div className={styles.formGrid}><label className={styles.formField}><span>Date</span><input type="date" value={date} onChange={(event) => editCommand(() => setDate(event.target.value))} /></label><label className={styles.formField}><span>Time</span><input type="time" value={time} onChange={(event) => editCommand(() => setTime(event.target.value))} /></label>{appointment.durationState === "unknown" && action === "rebook" ? <p className={styles.schedulerPreview}>Original duration is unknown. Rebook uses S3’s current server-resolved duration; no duration is sent from this form.</p> : <label className={styles.formField}><span>Duration</span><input type="number" min="5" max="60" value={duration} onChange={(event) => editCommand(() => setDuration(event.target.value))} /></label>}</div> : null}{action === "reassign" ? <label className={styles.formField}><span>Target doctor</span><select value={doctorId} onChange={(event) => editCommand(() => setDoctorId(event.target.value))}>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label> : null}{conflicts.length ? <ConflictReview conflicts={conflicts} acknowledged={acknowledged} setAcknowledged={setAcknowledged} /> : null}{futureWarning ? <label className={styles.reviewCheck}><input type="checkbox" checked={futureAcknowledged} onChange={(event) => setFutureAcknowledged(event.target.checked)} /> I reviewed the patient’s future appointment cap warning and want to continue.</label> : null}<p>Changes are checked by the Scheduler at save time.</p><button className={styles.primaryButton} onClick={() => void mutate(action)} disabled={busy || (action === "reschedule" && !remediationDurationValid) || (conflicts.length > 0 && !acknowledged) || Boolean(futureWarning && !futureAcknowledged)}>{busy ? "Saving…" : `Confirm ${action.replace("_", " ")}`}</button></div> : null}{error ? <div className={styles.errorBanner} role="alert"><span>{error}</span></div> : null}</div></Dialog>;
}
