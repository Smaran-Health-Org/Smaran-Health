"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { SendPatientPortalLink } from "@/components/send-patient-portal-link";
import { AppointmentInspector } from "@/components/scheduler-appointment-inspector";
import { SchedulerPatientSearch } from "@/components/scheduler-patient-search";
import styles from "@/components/clinical.module.css";
import type { ClinicDoctor } from "@/lib/db/clinics";
import type { SchedulerAppointmentSummary, SchedulerCalendar } from "@/lib/db/scheduler-read";
import { refreshPanelAppointment, selectAppointment, type SchedulerPanel } from "@/lib/scheduler/panel-state";
import type { StaffAvailabilityDay, StaffAvailabilityProjection } from "@/lib/scheduler/availability-projection";
import { availabilityAccessibleDescription, availabilityIntervalGeometry, availabilityMatchesScope, availabilitySegmentLabel } from "@/lib/scheduler/availability-view-model";
import type { Patient, SessionContext } from "@/types";
import { CALENDAR_DAY_HEIGHT_PX, CALENDAR_DAY_MINUTES, CALENDAR_LABEL_MINUTES, calendarAppointmentGeometry, calendarAppointmentOverlapLayout, calendarLaneGeometry, calendarMinuteOffset } from "@/lib/scheduler/calendar-geometry";
import { CalendarRequestGate } from "@/lib/scheduler/calendar-request";
import { calendarAppointmentAccessibleLabel, calendarAppointmentReadinessCue, calendarBookingMinuteForPointer, calendarOperationalSummary, kolkataClock, visibleCalendarDoctors } from "@/lib/scheduler/calendar-view-model";
import { bookingSemanticIdentity, displayedBookingDuration, hasValidDurationOverride, optionalDurationOverride, selectedDoctorTypeId } from "@/lib/scheduler/workspace-payloads";

type Conflict = { fingerprint: string; kind?: string; unresolvedDuration?: boolean; [key: string]: unknown };
type ApiIssue = { code?: string; conflicts?: Conflict[]; warning?: Conflict; error?: string };
type BookingPatient = Pick<Patient, "id" | "fullName" | "phone" | "email">;
type BookingType = { id: string; name: string; defaultDurationMinutes: number | null; resolvedDurationMinutes: number };
type BookingOptions = { effectiveIntervalMinutes: number; effectiveDefaultDurationMinutes: number; appointmentTypes: BookingType[] };
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
  const [availability, setAvailability] = useState<StaffAvailabilityProjection | null>(null);
  const [availabilityWarning, setAvailabilityWarning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<Prefill | null>(null);
  const [panel, setPanel] = useState<SchedulerPanel>({ kind: "none" });
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGate = useRef(new CalendarRequestGate());
  const inspectorGeneration = useRef(0);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const endDate = view === "week" ? addDays(date, 7) : addDays(date, 1);
  const selectedDoctors = visibleCalendarDoctors(view, doctorIds, weekDoctorId);
  function invalidateCalendar() { requestGate.current.cancel(); setCalendar(null); setAvailability(null); setAvailabilityWarning(false); setLoading(true); setError(null); }
  function changeDate(nextDate: string) { if (nextDate === date) return; invalidateCalendar(); setDate(nextDate); }
  function changeView(nextView: "day" | "week") { if (nextView === view) return; invalidateCalendar(); setView(nextView); }
  async function loadCalendar() {
    const request = requestGate.current.start();
    setLoading(true); setError(null); setAvailability(null); setAvailabilityWarning(false);
    if (selectedDoctors.length === 0) { setCalendar(null); setLoading(false); return; }
    const requestedDates = view === "week" ? Array.from({ length: 7 }, (_, index) => addDays(date, index)) : [date];
    // Both reads share the Phase 1 generation/abort signal. Either response from a
    // superseded toolbar selection is discarded; availability never gates cards.
    const availabilityParams = new URLSearchParams({ localDate: date, days: String(requestedDates.length) });
    selectedDoctors.forEach((doctorId) => availabilityParams.append("doctorId", doctorId));
    void fetch(`/api/scheduler/availability?${availabilityParams}`, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Availability could not be loaded.");
        return response.json() as Promise<StaffAvailabilityProjection>;
      })
      .then((projection) => {
        if (!request.isCurrent()) return;
        if (!availabilityMatchesScope(projection, selectedDoctors, requestedDates)) throw new Error("Availability scope mismatch.");
        setAvailability(projection);
      })
      .catch(() => { if (request.isCurrent()) setAvailabilityWarning(true); });
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
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  useEffect(() => {
    if (panel.kind === "none") return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !booking) closePanel(); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [panel, booking]); // eslint-disable-line react-hooks/exhaustive-deps
  function closePanel() {
    inspectorGeneration.current++;
    setPanel({ kind: "none" }); setInspectorLoading(false);
    const calendarTrigger = panel.kind === "appointment" ? document.querySelector<HTMLButtonElement>(`button[data-appointment-id="${panel.appointment.id}"]`) : null;
    if (panelTrigger.current?.isConnected) panelTrigger.current.focus();
    else if (calendarTrigger) calendarTrigger.focus();
    else searchTrigger.current?.focus();
  }
  function openSearch() { inspectorGeneration.current++; panelTrigger.current = searchTrigger.current; setPanel({ kind: "patient-search" }); setInspectorLoading(false); }
  function openAppointment(appointment: SchedulerAppointmentSummary) {
    panelTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(selectAppointment(appointment));
    void refreshAppointment(appointment.id);
  }
  async function refreshAppointment(id: string, message?: string) {
    const generation = ++inspectorGeneration.current;
    setInspectorLoading(true);
    if (message) setNotice(message);
    if (message) void loadCalendar();
    try {
      const response = await fetch(`/api/scheduler/appointments/${encodeURIComponent(id)}`);
      const payload = await response.json().catch(() => null) as { data?: SchedulerAppointmentSummary } | null;
      if (generation !== inspectorGeneration.current) return;
      if (!response.ok || !payload?.data) throw new Error("Appointment details are no longer available. Select it again from the calendar or patient history.");
      setPanel((current) => refreshPanelAppointment(current, payload.data!));
    } catch {
      if (generation === inspectorGeneration.current) { setPanel({ kind: "none" }); setNotice("Appointment details are no longer available. Select it again from the calendar or patient history."); }
    } finally { if (generation === inspectorGeneration.current) setInspectorLoading(false); }
  }
  function toggleDoctor(id: string) { if (doctorIds.length === 1 && doctorIds.includes(id)) return; invalidateCalendar(); setDoctorIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  const days = view === "week" ? Array.from({ length: 7 }, (_, index) => addDays(date, index)) : [date];
  const summary = calendar ? calendarOperationalSummary(calendar.appointments) : null;
  return <>
    <header className={styles.schedulerHeader}>
      <div><h1>Appointments</h1><p>{view === "week" ? `${date} – ${addDays(date, 6)}` : date} · Asia/Kolkata</p></div>
      <button className={styles.primaryButton} onClick={() => setBooking({ doctorId: selectedDoctors[0], date, time: "09:00" })}><Icon name="plus" /> New appointment</button>
    </header>
    {!loading && !error && summary ? <div className={styles.schedulerSummary} aria-label="Visible appointment summary"><span><strong>{summary.appointments}</strong> Active appointments</span><span><strong>{summary.intakePending}</strong> Intake pending</span><span><strong>{summary.waiting}</strong> Waiting</span></div> : null}
    <section className={styles.schedulerControls} aria-label="Scheduler controls">
      <div className={styles.schedulerDateControls}><button className={styles.secondaryButton} onClick={() => changeDate(addDays(date, view === "week" ? -7 : -1))} aria-label="Previous date"><Icon name="arrowLeft" /></button><button className={styles.secondaryButton} onClick={() => changeDate(localDate())}>Today</button><button className={styles.secondaryButton} onClick={() => changeDate(addDays(date, view === "week" ? 7 : 1))} aria-label="Next date"><Icon name="arrowRight" /></button><strong>{view === "week" ? `${date} – ${addDays(date, 6)}` : date}</strong></div>
      <div className={styles.schedulerToggle} role="group" aria-label="Calendar view"><button data-active={view === "day"} onClick={() => changeView("day")}>Day</button><button data-active={view === "week"} onClick={() => changeView("week")}>Week</button></div>
      {view === "week" ? <label className={styles.schedulerProviderSelect}>Doctor <select aria-label="Week doctor" value={weekDoctorId} onChange={(event) => { if (event.target.value !== weekDoctorId) { invalidateCalendar(); setWeekDoctorId(event.target.value); } }}>{initialDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label> : <details className={styles.schedulerProviderFilter}><summary>{doctorIds.length === initialDoctors.length ? "All doctors" : `${doctorIds.length} doctors`}</summary><div>{initialDoctors.map((doctor) => <label key={doctor.id}><input type="checkbox" checked={doctorIds.includes(doctor.id)} onChange={() => toggleDoctor(doctor.id)} /> {doctor.fullName}</label>)}</div></details>}
      <button ref={searchTrigger} type="button" className={styles.secondaryButton} aria-expanded={panel.kind === "patient-search"} aria-controls="scheduler-side-panel" onClick={openSearch}><Icon name="search" /> Search patient</button>
      <span className={styles.schedulerRulerBadge}>5 min ruler</span>
      <a className={styles.schedulerSettingsLink} href="/scheduler/settings">Settings</a>
    </section>
    {error ? <div className={styles.errorBanner} role="alert"><strong>Calendar unavailable.</strong><span>{error}</span><button className={styles.secondaryButton} onClick={() => void loadCalendar()}>Try again</button></div> : null}
    {!loading && !error && calendar && availabilityWarning ? <div className={styles.schedulerAvailabilityWarning} role="status">Availability could not be loaded. Appointments and exact-time booking remain available; save checks again.</div> : null}
    {notice ? <div ref={noticeRef} tabIndex={-1} className={styles.schedulerPreview} role="status">{notice}</div> : null}
    {loading ? <div className={styles.schedulerState} role="status">Loading appointments…</div> : null}
    {!loading && !error && calendar && calendar.appointments.length === 0 ? <div className={styles.schedulerEmptyNote}>No appointments in this range. Empty space is not a guaranteed appointment slot.</div> : null}
    <div className={styles.schedulerWorkspaceContent} data-panel-open={panel.kind !== "none"}>
      <div className={styles.schedulerCalendarPane}>{!loading && !error && calendar ? <SchedulerCalendarView calendar={calendar} availability={availability} days={days} doctorIds={selectedDoctors} onBook={setBooking} onSelect={openAppointment} /> : null}</div>
      {panel.kind !== "none" ? <aside id="scheduler-side-panel" className={styles.schedulerSidePanel} aria-label={panel.kind === "appointment" ? "Appointment details" : "Patient search and scheduling history"}>
        <div className={styles.schedulerSideHeader}><h2>{panel.kind === "appointment" ? "Appointment details" : "Patient search"}</h2><button type="button" className={styles.secondaryButton} onClick={closePanel} aria-label="Close Scheduler side panel">Close</button></div>
        {panel.kind === "appointment" ? inspectorLoading ? <p role="status">Loading latest appointment…</p> : <AppointmentInspector key={`${panel.appointment.id}:${panel.appointment.updatedAt}`} appointment={panel.appointment} doctors={calendar?.doctors ?? initialDoctors} role={role} onRefresh={(message) => void refreshAppointment(panel.appointment.id, message)} /> : <SchedulerPatientSearch role={role} onSelectAppointment={openAppointment} />}
      </aside> : null}
    </div>
    {booking ? <BookingDialog doctors={calendar?.doctors ?? initialDoctors} prefill={booking} onClose={() => setBooking(null)} onBooked={() => void loadCalendar()} /> : null}
  </>;
}

function SchedulerCalendarView({ calendar, availability, days, doctorIds, onBook, onSelect }: { calendar: SchedulerCalendar; availability: StaffAvailabilityProjection | null; days: string[]; doctorIds: string[]; onBook: (prefill: Prefill) => void; onSelect: (appointment: SchedulerAppointmentSummary) => void }) {
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
    <div className={styles.schedulerGridHeader}><span>IST</span>{columns.map(({ day, doctor }) => {
      const state = availability?.days.find((item) => item.doctorId === doctor.id && item.localDate === day)?.status;
      return <strong key={`${day}-${doctor.id}`}><span>{days.length > 1 ? `${day.slice(5)} · ` : ""}{doctor.fullName}</span><small>{calendar.appointments.filter((item) => item.doctorId === doctor.id && appointmentDate(item.scheduledAt) === day && item.status === "scheduled").length} appointments{state === "not_bookable" ? " · Not bookable" : state === "configuration_invalid" ? " · Schedule needs review" : ""}</small></strong>;
    })}</div>
    <div className={styles.schedulerTimeline} style={{ height: CALENDAR_DAY_HEIGHT_PX }}>
      <div className={styles.schedulerTimeRuler}>{labels.map((minute) => <time key={minute} dateTime={`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`} style={{ top: calendarMinuteOffset(minute) }}>{String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}</time>)}</div>
      {columns.map(({ day, doctor }) => {
        const dayAppointments = calendar.appointments.filter((item) => item.doctorId === doctor.id && appointmentDate(item.scheduledAt) === day);
        const starts = dayAppointments.map((appointment) => {
          const [hour, minute] = appointmentTime(appointment.scheduledAt).split(":").map(Number);
          return { id: appointment.id, startMinute: (hour % 24) * 60 + minute, durationMinutes: appointment.durationMinutes };
        });
        const lanes = new Map(calendarAppointmentOverlapLayout(starts).map((lane) => [lane.id, lane]));
        const dayAvailability = availability?.days.find((item) => item.doctorId === doctor.id && item.localDate === day);
        return <div className={styles.schedulerTimelineColumn} key={`${day}-${doctor.id}`}>
          {dayAvailability ? <SchedulerAvailabilityLayer day={dayAvailability} doctorName={doctor.fullName} /> : null}
          <div className={styles.schedulerTimePicker} aria-hidden="true" onClick={(event) => {
            const minute = calendarBookingMinuteForPointer(event.clientY - event.currentTarget.getBoundingClientRect().top);
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
            const cue = calendarAppointmentReadinessCue(appointment);
            return <button key={appointment.id} className={styles.schedulerAppointment} data-appointment-id={appointment.id} data-status={appointment.status} data-unknown={geometry.isUnknownDuration} data-size={compact ? "compact" : small ? "small" : "regular"} style={{ top: geometry.topPx, height: geometry.heightPx, ...lanePosition } as CSSProperties} onClick={() => onSelect(appointment)} aria-label={calendarAppointmentAccessibleLabel(appointment, appointmentTime(appointment.scheduledAt))} title={`${appointment.patientName} · ${appointmentTime(appointment.scheduledAt)} · ${duration === null ? "Duration unknown" : `${duration} min`}`}>
              {compact ? <span className={styles.schedulerCompactText}>{appointment.patientName} · {duration}m</span> : <><strong>{appointment.patientName}</strong>{duration === null ? <span>Duration unknown</span> : small ? (cue ? <small>{cue}</small> : null) : <span>{appointment.appointmentTypeName ?? "Appointment"} · {duration}m</span>}{duration !== null && duration >= 20 && cue ? <small>{cue}</small> : null}</>}
            </button>;
          })}
        </div>;
      })}
      {days.length === 1 && days[0] === clock.date ? <div className={styles.schedulerNowLine} style={{ top: calendarMinuteOffset(clock.minute) }} aria-label={`Current time ${clock.time}`}><span>NOW · {clock.time}</span></div> : null}
      {days.length > 1 && columns.map(({ day, doctor }, index) => day === clock.date ? <div key={`now-${day}-${doctor.id}`} className={styles.schedulerNowLine} data-column style={{ top: calendarMinuteOffset(clock.minute), left: `calc(${index * 100 / columns.length}% + ${64 * (1 - index / columns.length)}px)`, width: `calc(${100 / columns.length}% - ${64 / columns.length}px)`, right: "auto" }} aria-label={`Current time ${clock.time}`}><span>NOW · {clock.time}</span></div> : null)}
    </div>
    <p className={styles.schedulerGridHint}>5-minute visual ruler · Exact-minute staff booking. {availability ? "Working and clean time are advisory, not guaranteed appointment slots; save checks again." : "Empty space does not indicate availability."}</p>
  </section>;
}

function SchedulerAvailabilityLayer({ day, doctorName }: { day: StaffAvailabilityDay; doctorName: string }) {
  const description = availabilityAccessibleDescription(doctorName, day);
  if (day.status === "configuration_invalid") return <div className={styles.schedulerAvailabilityStatus} role="img" aria-label={description}>Schedule configuration needs review</div>;
  return <div className={styles.schedulerAvailabilityLayer} data-status={day.status} role="img" aria-label={description}>
    {day.segments.map((segment, index) => {
      const geometry = availabilityIntervalGeometry(day.localDate, segment);
      return geometry ? <div key={`segment-${index}`} className={styles.schedulerAvailabilitySegment} data-kind={segment.kind} style={{ top: geometry.top, height: geometry.height }}>
        {geometry.height >= 52 && segment.kind !== "working" ? <span>{availabilitySegmentLabel(segment.kind)}</span> : null}
      </div> : null;
    })}
    {day.status === "ok" ? day.cleanIntervals.map((interval, index) => {
      const geometry = availabilityIntervalGeometry(day.localDate, interval);
      return geometry ? <div key={`clean-${index}`} className={styles.schedulerCleanInterval} style={{ top: geometry.top, height: geometry.height }} /> : null;
    }) : null}
    {day.status === "not_bookable" ? <span className={styles.schedulerAvailabilityStatus}>Doctor not bookable</span> : null}
  </div>;
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
