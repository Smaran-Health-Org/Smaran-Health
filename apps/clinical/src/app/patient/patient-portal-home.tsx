"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./patient-portal.module.css";

type Doctor = { doctorId: string; displayName: string };
type Appointment = { id: string; scheduledAt: string; status: string; doctorDisplayName: string };

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
    void fetch(`/patient/api/availability?doctorId=${encodeURIComponent(doctorId)}&localDate=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Available times could not be loaded.");
        const body = await response.json() as { availability: { bookableStarts?: number[] } };
        setTimes((body.availability.bookableStarts ?? []).map((start) => new Date(start).toISOString()));
      }).catch(() => setTimes([]));
  }, [doctorId, date]);

  async function logout() {
    await fetch("/patient/api/logout", { method: "POST" });
    router.push("/patient/access/expired");
  }

  if (loading) return <main className={styles.page}><section className={styles.card}><p>Opening your secure portal…</p></section></main>;
  if (error) return <main className={styles.page}><section className={styles.card}><h1>Portal unavailable</h1><p>{error}</p></section></main>;
  return <main className={styles.page}><section className={styles.wideCard}>
    <header className={styles.header}><div><p className={styles.brand}>Smaran Health</p><h1>Patient portal</h1></div><button className={styles.secondary} onClick={logout}>Sign out</button></header>
    <section><h2>Book appointment</h2><p className={styles.muted}>Choose a doctor and date to see clean availability.</p>
      <div className={styles.bookingFields}><label>Doctor<select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>{doctors.map((doctor) => <option key={doctor.doctorId} value={doctor.doctorId}>{doctor.displayName}</option>)}</select></label>
      <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
      {times.length ? <div className={styles.times}>{times.map((time) => <span key={time}>{new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" }).format(new Date(time))}</span>)}</div> : <p className={styles.muted}>No available times for this selection.</p>}
    </section>
    <section className={styles.columns}><div><h2>Upcoming</h2>{upcoming.length ? <ul>{upcoming.map((item) => <li key={item.id}>{appointmentTime(item.scheduledAt)} · {item.doctorDisplayName}</li>)}</ul> : <p className={styles.muted}>No upcoming appointments.</p>}</div>
      <div><h2>History</h2>{history.length ? <ul>{history.map((item) => <li key={item.id}>{appointmentTime(item.scheduledAt)} · {item.doctorDisplayName}</li>)}</ul> : <p className={styles.muted}>No previous appointments.</p>}</div></section>
  </section></main>;
}
