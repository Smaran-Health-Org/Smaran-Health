"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Icon } from "@/components/icons";
import { AppointmentInspector } from "@/components/scheduler-appointment-inspector";
import { SchedulerPatientSearch } from "@/components/scheduler-patient-search";
import { SchedulerBookingPanel } from "@/components/scheduler-booking-panel";
import { SchedulerAgendaView } from "@/components/scheduler-agenda-view";
import styles from "@/components/clinical.module.css";
import type { ClinicDoctor } from "@/lib/db/clinics";
import type { SchedulerAppointmentSummary, SchedulerCalendar } from "@/lib/db/scheduler-read";
import { refreshPanelAppointment, selectAppointment, type SchedulerPanel } from "@/lib/scheduler/panel-state";
import type { StaffAvailabilityDay, StaffAvailabilityProjection } from "@/lib/scheduler/availability-projection";
import { availabilityAccessibleDescription, availabilityIntervalGeometry, availabilityMatchesScope, availabilitySegmentLabel } from "@/lib/scheduler/availability-view-model";
import type { SessionContext } from "@/types";
import { CALENDAR_DAY_HEIGHT_PX, CALENDAR_DAY_MINUTES, CALENDAR_LABEL_MINUTES, CALENDAR_PX_PER_MINUTE, CALENDAR_VISUAL_RULER_MINUTES, calendarAppointmentGeometry, calendarAppointmentOverlapLayout, calendarLaneGeometry, calendarMinuteOffset } from "@/lib/scheduler/calendar-geometry";
import { CalendarRequestGate } from "@/lib/scheduler/calendar-request";
import { calendarAppointmentAccessibleLabel, calendarAppointmentReadinessCue, calendarBookingRulerMinute, calendarOperationalSummary, kolkataClock, visibleCalendarDoctors } from "@/lib/scheduler/calendar-view-model";
type Prefill = Extract<SchedulerPanel, { kind: "booking" }>["prefill"];

const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localDate(value = new Date()): string { return formatter.format(value); }
function localStart(date: string): string { return `${date}T00:00:00+05:30`; }
function addDays(date: string, days: number): string { const base = new Date(`${date}T00:00:00+05:30`); base.setUTCDate(base.getUTCDate() + days); return localDate(base); }
function appointmentTime(value: string): string { return timeFormatter.format(new Date(value)); }
function appointmentDate(value: string): string { return localDate(new Date(value)); }
function safeError(payload: unknown, fallback: string): string { return typeof payload === "object" && payload && "error" in payload && typeof (payload as { error?: unknown }).error === "string" ? (payload as { error: string }).error : fallback; }

export function SchedulerWorkspace({ initialDoctors, role, actorDoctorId }: { initialDoctors: ClinicDoctor[]; role: SessionContext["role"]; actorDoctorId: string }) {
  const visibleDoctors = role === "doctor"
    ? initialDoctors.filter((doctor) => doctor.id === actorDoctorId)
    : initialDoctors;
  const [date, setDate] = useState(localDate());
  const [view, setView] = useState<"day" | "week" | "agenda">("day");
  const [agendaRange, setAgendaRange] = useState<"day" | "week">("day");
  const [doctorIds, setDoctorIds] = useState<string[]>(visibleDoctors.map((doctor) => doctor.id));
  const [weekDoctorId, setWeekDoctorId] = useState(visibleDoctors[0]?.id ?? "");
  const [calendar, setCalendar] = useState<SchedulerCalendar | null>(null);
  const [availability, setAvailability] = useState<StaffAvailabilityProjection | null>(null);
  const [availabilityWarning, setAvailabilityWarning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<SchedulerPanel>({ kind: "none" });
  const [overlay, setOverlay] = useState(false);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGate = useRef(new CalendarRequestGate());
  const inspectorGeneration = useRef(0);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const range = view === "agenda" ? agendaRange : view;
  const endDate = range === "week" ? addDays(date, 7) : addDays(date, 1);
  const selectedDoctors = visibleCalendarDoctors(range, doctorIds, weekDoctorId);
  function invalidateCalendar() { requestGate.current.cancel(); setCalendar(null); setAvailability(null); setAvailabilityWarning(false); setLoading(true); setError(null); }
  function changeDate(nextDate: string) { if (nextDate === date) return; invalidateCalendar(); setDate(nextDate); }
  function changeView(nextView: "day" | "week" | "agenda") { if (nextView === view) return; if (nextView !== "agenda") setAgendaRange(nextView); if (nextView !== "agenda" && nextView !== range) invalidateCalendar(); setView(nextView); }
  function changeAgendaRange(nextRange: "day" | "week") { if (nextRange === agendaRange) return; invalidateCalendar(); setAgendaRange(nextRange); }
  async function loadCalendar() {
    const request = requestGate.current.start();
    setLoading(true); setError(null); setAvailability(null); setAvailabilityWarning(false);
    if (selectedDoctors.length === 0) { setCalendar(null); setLoading(false); return; }
    const requestedDates = range === "week" ? Array.from({ length: 7 }, (_, index) => addDays(date, index)) : [date];
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
  }, [date, range, doctorIds.join(","), weekDoctorId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1080px)");
    const update = () => setOverlay(media.matches);
    update(); media.addEventListener("change", update);
    const phone = window.matchMedia("(max-width: 680px)");
    const preferAgenda = () => { if (phone.matches) setView("agenda"); };
    phone.addEventListener("change", preferAgenda);
    const timer = window.setTimeout(preferAgenda, 0);
    return () => { media.removeEventListener("change", update); phone.removeEventListener("change", preferAgenda); window.clearTimeout(timer); };
  }, []);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  useEffect(() => {
    if (panel.kind === "none") return;
    if (overlay && panel.kind === "appointment") document.querySelector<HTMLElement>("#scheduler-side-panel .scheduler-panel-close")?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
      if (event.key !== "Tab" || !overlay) return;
      const node = document.getElementById("scheduler-side-panel");
      const focusable = [...(node?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]') ?? [])];
      if (!focusable.length) return;
      if (node && !node.contains(document.activeElement)) { event.preventDefault(); focusable[0].focus(); return; }
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [panel, overlay]); // eslint-disable-line react-hooks/exhaustive-deps
  function closePanel() {
    inspectorGeneration.current++;
    setPanel({ kind: "none" }); setInspectorLoading(false);
    const calendarTrigger = panel.kind === "appointment" ? document.querySelector<HTMLButtonElement>(`button[data-appointment-id="${panel.appointment.id}"]`) : null;
    if (panelTrigger.current?.isConnected) panelTrigger.current.focus();
    else if (calendarTrigger) calendarTrigger.focus();
    else searchTrigger.current?.focus();
  }
  function openSearch() { inspectorGeneration.current++; panelTrigger.current = searchTrigger.current; setPanel({ kind: "patient-search" }); setInspectorLoading(false); }
  function openBooking(prefill: Prefill) {
    inspectorGeneration.current++;
    panelTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel({ kind: "booking", prefill }); setInspectorLoading(false);
  }
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
  async function viewBookedAppointment(id: string) {
    try {
      const response = await fetch(`/api/scheduler/appointments/${encodeURIComponent(id)}`);
      const payload = await response.json().catch(() => null) as { data?: SchedulerAppointmentSummary } | null;
      if (!response.ok || !payload?.data) throw new Error("Appointment details unavailable.");
      openAppointment(payload.data);
    } catch { setNotice("Appointment saved. Its details could not be loaded yet; refresh the calendar to select it."); }
  }
  function toggleDoctor(id: string) { if (doctorIds.length === 1 && doctorIds.includes(id)) return; invalidateCalendar(); setDoctorIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  const days = range === "week" ? Array.from({ length: 7 }, (_, index) => addDays(date, index)) : [date];
  const summary = calendar ? calendarOperationalSummary(calendar.appointments) : null;
  return <>
    <header className={styles.schedulerHeader}>
      <div><h1>Appointments</h1><p>{range === "week" ? `${date} – ${addDays(date, 6)}` : date} · Asia/Kolkata</p></div>
      <button className={styles.primaryButton} onClick={() => openBooking({ doctorId: selectedDoctors[0], date, time: "09:00" })}><Icon name="plus" /> New appointment</button>
    </header>
    {!loading && !error && summary ? <div className={styles.schedulerSummary} aria-label="Visible appointment summary"><span><strong>{summary.appointments}</strong> Active appointments</span><span><strong>{summary.intakePending}</strong> Intake pending</span><span><strong>{summary.waiting}</strong> Waiting</span></div> : null}
    <section className={styles.schedulerControls} aria-label="Scheduler controls">
      <div className={styles.schedulerDateControls}><button className={styles.secondaryButton} onClick={() => changeDate(addDays(date, range === "week" ? -7 : -1))} aria-label="Previous date"><Icon name="arrowLeft" /></button><button className={styles.secondaryButton} onClick={() => changeDate(localDate())}>Today</button><button className={styles.secondaryButton} onClick={() => changeDate(addDays(date, range === "week" ? 7 : 1))} aria-label="Next date"><Icon name="arrowRight" /></button><strong>{range === "week" ? `${date} – ${addDays(date, 6)}` : date}</strong></div>
      <div className={styles.schedulerToggle} role="group" aria-label="Scheduler view"><button data-active={view === "day"} onClick={() => changeView("day")}>Day</button><button data-active={view === "week"} onClick={() => changeView("week")}>Week</button><button data-active={view === "agenda"} onClick={() => changeView("agenda")}>Agenda</button></div>
      {view === "agenda" ? <label className={styles.schedulerProviderSelect}>Agenda range <select aria-label="Agenda range" value={agendaRange} onChange={(event) => changeAgendaRange(event.target.value as "day" | "week")}><option value="day">Day · selected doctors</option><option value="week">Week · one doctor</option></select></label> : null}
      {range === "week" ? <label className={styles.schedulerProviderSelect}>Doctor <select aria-label="Week doctor" value={weekDoctorId} onChange={(event) => { if (event.target.value !== weekDoctorId) { invalidateCalendar(); setWeekDoctorId(event.target.value); } }}>{visibleDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label> : role === "doctor" ? <span className={styles.schedulerRulerBadge}>Your schedule</span> : <details className={styles.schedulerProviderFilter}><summary>{doctorIds.length === visibleDoctors.length ? "All doctors" : `${doctorIds.length} doctors`}</summary><div>{visibleDoctors.map((doctor) => <label key={doctor.id}><input type="checkbox" checked={doctorIds.includes(doctor.id)} onChange={() => toggleDoctor(doctor.id)} /> {doctor.fullName}</label>)}</div></details>}
      <button ref={searchTrigger} type="button" className={styles.secondaryButton} aria-expanded={panel.kind === "patient-search"} aria-controls="scheduler-side-panel" onClick={openSearch}><Icon name="search" /> Search patient</button>
      {view !== "agenda" ? <span className={styles.schedulerRulerBadge}>5 min ruler</span> : null}
      <a className={styles.schedulerSettingsLink} href="/scheduler/settings">Settings</a>
    </section>
    {error ? <div className={styles.errorBanner} role="alert"><strong>Calendar unavailable.</strong><span>{error}</span><button className={styles.secondaryButton} onClick={() => void loadCalendar()}>Try again</button></div> : null}
    {!loading && !error && calendar && availabilityWarning && view !== "agenda" ? <div className={styles.schedulerAvailabilityWarning} role="status">Availability could not be loaded. Appointments and exact-time booking remain available; save checks again.</div> : null}
    {notice ? <div ref={noticeRef} tabIndex={-1} className={styles.schedulerPreview} role="status">{notice}</div> : null}
    {loading ? <div className={styles.schedulerState} role="status">Loading appointments…</div> : null}
    {!loading && !error && calendar && calendar.appointments.length === 0 && view !== "agenda" ? <div className={styles.schedulerEmptyNote}>No appointments in this range. Empty space is not a guaranteed appointment slot.</div> : null}
    <div className={styles.schedulerWorkspaceContent} data-panel-open={panel.kind !== "none"}>
      <div className={styles.schedulerCalendarPane}>{!loading && !error && calendar ? view === "agenda" ? <SchedulerAgendaView appointments={calendar.appointments} scope={range === "week" ? `${date}–${addDays(date, 6)}, ${calendar.doctors.find((doctor) => doctor.id === weekDoctorId)?.fullName ?? "one doctor"}` : `${date}, ${selectedDoctors.length} selected doctor${selectedDoctors.length === 1 ? "" : "s"}`} onSelect={openAppointment} /> : <SchedulerCalendarView calendar={calendar} availability={availability} days={days} doctorIds={selectedDoctors} onBook={openBooking} onSelect={openAppointment} /> : null}</div>
      {panel.kind !== "none" && overlay ? <button type="button" className={styles.schedulerPanelBackdrop} aria-label="Close Scheduler panel" onClick={closePanel} /> : null}
      {panel.kind !== "none" ? <aside id="scheduler-side-panel" key={panel.kind === "booking" ? `booking-${panel.prefill.doctorId}-${panel.prefill.date}-${panel.prefill.time}-${panel.prefill.patient?.id}` : panel.kind} className={styles.schedulerSidePanel} role={overlay ? "dialog" : undefined} aria-modal={overlay ? true : undefined} aria-label={panel.kind === "appointment" ? "Appointment details" : panel.kind === "booking" ? "Book appointment" : "Patient search and scheduling history"}>
        <div className={styles.schedulerSideHeader}><h2>{panel.kind === "appointment" ? "Appointment details" : panel.kind === "booking" ? "Book appointment" : "Patient search"}</h2><button type="button" className={`${styles.secondaryButton} scheduler-panel-close`} onClick={closePanel} aria-label="Close Scheduler side panel">Close</button></div>
        {panel.kind === "appointment" ? inspectorLoading ? <p role="status">Loading latest appointment…</p> : <AppointmentInspector key={`${panel.appointment.id}:${panel.appointment.updatedAt}`} appointment={panel.appointment} doctors={calendar?.doctors ?? visibleDoctors} role={role} onRefresh={(message) => void refreshAppointment(panel.appointment.id, message)} /> : panel.kind === "booking" ? <SchedulerBookingPanel doctors={calendar?.doctors ?? visibleDoctors} prefill={panel.prefill} onBooked={() => { void loadCalendar(); }} onViewAppointment={(id) => void viewBookedAppointment(id)} /> : <SchedulerPatientSearch role={role} onSelectAppointment={openAppointment} onBookPatient={(patient) => openBooking({ patient, doctorId: selectedDoctors[0], date, time: "09:00" })} />}
      </aside> : null}
    </div>
  </>;
}

function SchedulerCalendarView({ calendar, availability, days, doctorIds, onBook, onSelect }: { calendar: SchedulerCalendar; availability: StaffAvailabilityProjection | null; days: string[]; doctorIds: string[]; onBook: (prefill: Prefill) => void; onSelect: (appointment: SchedulerAppointmentSummary) => void }) {
  const doctors = calendar.doctors.filter((doctor) => doctorIds.includes(doctor.id));
  const columns = days.flatMap((day) => doctors.map((doctor) => ({ day, doctor })));
  const scrollRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [hoveredSlot, setHoveredSlot] = useState<{ day: string; doctorId: string; minute: number } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ day: string; doctorId: string; minute: number } | null>(null);
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
  const slotHeight = CALENDAR_VISUAL_RULER_MINUTES * CALENDAR_PX_PER_MINUTE;
  return <section ref={scrollRef} className={styles.schedulerCalendar} style={{ "--scheduler-columns": columns.length, "--scheduler-five-minute-height": `${slotHeight}px`, "--scheduler-fifteen-minute-height": `${CALENDAR_LABEL_MINUTES * CALENDAR_PX_PER_MINUTE}px`, "--scheduler-short-card-height": `${slotHeight}px` } as CSSProperties} aria-label="Appointment calendar">
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
        const slotFor = (event: MouseEvent<HTMLDivElement>) => calendarBookingRulerMinute(event.clientY - event.currentTarget.getBoundingClientRect().top);
        const previewSlot = hoveredSlot?.day === day && hoveredSlot.doctorId === doctor.id ? hoveredSlot : selectedSlot?.day === day && selectedSlot.doctorId === doctor.id ? selectedSlot : null;
        return <div className={styles.schedulerTimelineColumn} key={`${day}-${doctor.id}`}>
          {dayAvailability ? <SchedulerAvailabilityLayer day={dayAvailability} doctorName={doctor.fullName} /> : null}
          {previewSlot ? <div className={styles.schedulerTimeSlotPreview} data-selected={selectedSlot?.day === day && selectedSlot.doctorId === doctor.id && selectedSlot.minute === previewSlot.minute} style={{ top: calendarMinuteOffset(previewSlot.minute), height: slotHeight }} aria-hidden="true" /> : null}
          <div className={styles.schedulerTimePicker} aria-hidden="true" onMouseMove={(event) => setHoveredSlot({ day, doctorId: doctor.id, minute: slotFor(event) })} onMouseLeave={() => setHoveredSlot(null)} onClick={(event) => {
            const minute = slotFor(event);
            setSelectedSlot({ day, doctorId: doctor.id, minute });
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
