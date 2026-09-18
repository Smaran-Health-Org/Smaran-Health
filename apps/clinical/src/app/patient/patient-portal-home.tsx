"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./patient-portal.module.css";

type Doctor = { doctorId: string; displayName: string };
type Appointment = { id: string; scheduledAt: string; status: string; doctorDisplayName: string };
type AppointmentDetail = Appointment & { preparation: { intakeStatus: string; canOpenPreparation: boolean }; timeline: Array<{ eventType: string; occurredAt: string }> };

function localDateToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function appointmentTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function PatientPortalHome() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(localDateToday);
  const [times, setTimes] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [warningProof, setWarningProof] = useState<string | null>(null);
  const [bookingMessage, setBookingMessage] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [justBooked, setJustBooked] = useState<Appointment | null>(null);
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const [openingPreparation, setOpeningPreparation] = useState(false);

  function clearBookingSelection() {
    setSelectedTime(null);
    setBookingKey(null);
    setWarningProof(null);
    setBookingMessage(null);
  }

  useEffect(() => {
    void Promise.all([
      fetch("/patient/api/portal", { cache: "no-store" }), fetch("/patient/api/doctors", { cache: "no-store" }),
      fetch("/patient/api/appointments?kind=upcoming", { cache: "no-store" }), fetch("/patient/api/appointments?kind=history", { cache: "no-store" }),
    ]).then(async ([session, doctorResponse, upcomingResponse, historyResponse]) => {
      if (!session.ok || !doctorResponse.ok || !upcomingResponse.ok || !historyResponse.ok) throw new Error("Your portal session has expired.");
      const [doctorBody, upcomingBody, historyBody] = await Promise.all([doctorResponse.json(), upcomingResponse.json(), historyResponse.json()]);
      setDoctors(doctorBody.doctors); setDoctorId(doctorBody.doctors[0]?.doctorId ?? "");
      setUpcoming(upcomingBody.appointments); setHistory(historyBody.appointments);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not open the patient portal."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!doctorId || !date) return;
    const controller = new AbortController();
    void fetch(`/patient/api/availability?doctorId=${encodeURIComponent(doctorId)}&localDate=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Available times could not be loaded.");
        const body = await response.json() as { availability: { bookableStarts?: number[] } };
        if (!controller.signal.aborted) setTimes((body.availability.bookableStarts ?? []).map((start) => new Date(start).toISOString()));
      }).catch(() => { if (!controller.signal.aborted) setTimes([]); });
    return () => controller.abort();
  }, [doctorId, date]);

  async function logout() {
    await fetch("/patient/api/logout", { method: "POST" });
    router.push("/patient/access/expired");
  }

  async function confirmBooking() {
    if (!doctorId || !selectedTime || !bookingKey) return;
    setBooking(true); setBookingMessage(null);
    try {
      const response = await fetch("/patient/api/scheduler/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, scheduledAt: selectedTime, idempotencyKey: bookingKey, ...(warningProof ? { warningProof } : {}) }),
      });
      const body = await response.json() as { code?: string; error?: string; warningProof?: string; booking?: Pick<Appointment, "id" | "scheduledAt"> };
      if (response.ok && body.booking) {
        setBookingMessage(`Your appointment is confirmed for ${appointmentTime(body.booking.scheduledAt)}.`);
        setJustBooked({
          ...body.booking,
          status: "scheduled",
          doctorDisplayName: doctors.find((doctor) => doctor.doctorId === doctorId)?.displayName ?? "Doctor",
        });
        setDetail(null);
        setSelectedTime(null); setWarningProof(null); setBookingKey(null);
        const upcomingResponse = await fetch("/patient/api/appointments?kind=upcoming", { cache: "no-store" });
        if (upcomingResponse.ok) setUpcoming((await upcomingResponse.json() as { appointments: Appointment[] }).appointments);
        // This keeps the verified Portal session in place and immediately
        // reveals the existing S6 preparation handoff when it is available.
        await openDetail(body.booking.id);
      } else if (body.code === "warning_required" && body.warningProof) {
        setWarningProof(body.warningProof);
        setBookingMessage("You already have an upcoming appointment. Confirm again if you still want this time.");
      } else {
        setSelectedTime(null); setWarningProof(null); setBookingKey(null); setBookingMessage(body.error ?? "That time is no longer available. Please choose another time.");
      }
    } catch {
      setBookingMessage("Could not confirm this appointment. Please try again.");
    } finally { setBooking(false); }
  }

  async function openDetail(appointmentId: string) {
    setDetailMessage(null);
    try {
      const response = await fetch(`/patient/api/appointments/${encodeURIComponent(appointmentId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load appointment details.");
      setDetail((await response.json() as { appointment: AppointmentDetail }).appointment);
    } catch (reason) { setDetailMessage(reason instanceof Error ? reason.message : "Could not load appointment details."); }
  }

  async function openPreparation() {
    if (!detail) return;
    setOpeningPreparation(true); setDetailMessage(null);
    try {
      const response = await fetch(`/patient/api/appointments/${encodeURIComponent(detail.id)}/intake-handoff`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }), redirect: "follow",
      });
      if (response.redirected) { window.location.assign(response.url); return; }
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not open preparation.");
    } catch (reason) { setDetailMessage(reason instanceof Error ? reason.message : "Could not open preparation."); }
    finally { setOpeningPreparation(false); }
  }

  function appointmentStatusLabel(appointment: Appointment, section: "upcoming" | "history") {
    if (appointment.status === "scheduled" && section === "history") return "Past scheduled time";
    return appointment.status.replaceAll("_", " ");
  }

  function timelineLabel(eventType: string) {
    return ({ created: "Booked", rescheduled: "Rescheduled", reassigned: "Doctor updated", cancelled: "Cancelled", no_show: "Marked no-show", rebooked: "Rebooked" } as Record<string, string>)[eventType] ?? "Scheduling update";
  }

  if (loading) return <main className={styles.page}><section className={styles.card}><p>Opening your secure portal…</p></section></main>;
  if (error) return <main className={styles.page}><section className={styles.card}><h1>Portal unavailable</h1><p>{error}</p></section></main>;
  return <main className={styles.page}><section className={styles.wideCard}>
    <header className={styles.header}><div><p className={styles.brand}>Smaran Health</p><h1>Patient portal</h1></div><button className={styles.secondary} onClick={logout}>Sign out</button></header>
    <section><h2>Book appointment</h2><p className={styles.muted}>Choose a doctor and date to see clean availability.</p>
      <div className={styles.bookingFields}><label>Doctor<select value={doctorId} onChange={(event) => { clearBookingSelection(); setTimes([]); setDoctorId(event.target.value); }}>{doctors.map((doctor) => <option key={doctor.doctorId} value={doctor.doctorId}>{doctor.displayName}</option>)}</select></label>
      <label>Date<input type="date" value={date} onChange={(event) => { clearBookingSelection(); setTimes([]); setDate(event.target.value); }} /></label></div>
      {times.length ? <div className={styles.times}>{times.map((time) => <button type="button" className={selectedTime === time ? styles.selectedTime : styles.time} key={time} onClick={() => { setSelectedTime(time); setBookingKey(crypto.randomUUID()); setWarningProof(null); setBookingMessage(null); }}>{new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" }).format(new Date(time))}</button>)}</div> : <p className={styles.muted}>No available times for this selection.</p>}
      {selectedTime ? <div className={styles.confirm}><p>Selected: {appointmentTime(selectedTime)}</p>{bookingMessage ? <p className={styles.muted}>{bookingMessage}</p> : null}<button disabled={booking} onClick={confirmBooking}>{warningProof ? "Confirm despite existing appointment" : "Confirm appointment"}</button></div> : null}
      {!selectedTime && bookingMessage ? <p className={styles.muted}>{bookingMessage}</p> : null}
      {justBooked ? <div className={styles.confirm}><strong>Your new appointment</strong><p>{appointmentTime(justBooked.scheduledAt)} · {justBooked.doctorDisplayName}</p><button onClick={() => void openDetail(justBooked.id)}>View appointment details</button></div> : null}
    </section>
    <section className={styles.columns}><div><h2>Upcoming</h2>{upcoming.length ? <ul>{upcoming.map((item) => <li key={item.id}><button className={styles.secondary} onClick={() => void openDetail(item.id)}>{appointmentTime(item.scheduledAt)} · {item.doctorDisplayName} · {appointmentStatusLabel(item, "upcoming")}</button></li>)}</ul> : <p className={styles.muted}>No upcoming appointments.</p>}</div>
      <div><h2>History</h2>{history.length ? <ul>{history.map((item) => <li key={item.id}><button className={styles.secondary} onClick={() => void openDetail(item.id)}>{appointmentTime(item.scheduledAt)} · {item.doctorDisplayName} · {appointmentStatusLabel(item, "history")}</button></li>)}</ul> : <p className={styles.muted}>No previous appointments.</p>}</div></section>
    {detail ? <section className={styles.confirm}><h2>Appointment details</h2><p>{appointmentTime(detail.scheduledAt)} · {detail.doctorDisplayName}</p><p className={styles.muted}>Preparation: {detail.preparation.intakeStatus.replace("_", " ")}</p>{detail.preparation.canOpenPreparation ? <button disabled={openingPreparation} onClick={() => void openPreparation()}>{openingPreparation ? "Opening…" : "Complete details / upload documents"}</button> : null}{detail.timeline.length ? <section><h3>Scheduling updates</h3><ul>{detail.timeline.map((event, index) => <li key={`${event.eventType}-${event.occurredAt}-${index}`}>{timelineLabel(event.eventType)} · {appointmentTime(event.occurredAt)}</li>)}</ul></section> : null}{detailMessage ? <p className={styles.muted}>{detailMessage}</p> : null}</section> : detailMessage ? <p className={styles.muted}>{detailMessage}</p> : null}
  </section></main>;
}
