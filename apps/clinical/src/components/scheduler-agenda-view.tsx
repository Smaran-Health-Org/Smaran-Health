"use client";

import styles from "@/components/clinical.module.css";
import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";
import { agendaAppointments, agendaDay, agendaOperationalCues } from "@/lib/scheduler/agenda-view-model";

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function SchedulerAgendaView({ appointments, scope, onSelect }: {
  appointments: readonly SchedulerAppointmentSummary[]; scope: string; onSelect: (appointment: SchedulerAppointmentSummary) => void;
}) {
  const sorted = agendaAppointments(appointments);
  return <section className={styles.schedulerAgenda} aria-label={`Appointment agenda, ${scope}`}>
    <div className={styles.schedulerAgendaHeader}><h2>Agenda</h2><p>{scope} · Asia/Kolkata</p></div>
    {sorted.length === 0 ? <p className={styles.schedulerAgendaEmpty}>No appointments in this range.</p> : sorted.map((appointment, index) => {
      const currentDay = agendaDay(appointment);
      const previousDay = index ? agendaDay(sorted[index - 1]) : null;
      const clock = time.format(new Date(appointment.scheduledAt));
      const cues = agendaOperationalCues(appointment);
      return <div key={appointment.id}>
        {currentDay !== previousDay ? <h3 className={styles.schedulerAgendaDay}>{currentDay}</h3> : null}
        <button type="button" className={styles.schedulerAgendaItem} data-status={appointment.status} data-appointment-id={appointment.id} onClick={() => onSelect(appointment)} aria-label={`Open ${appointment.status.replaceAll("_", " ")} appointment for ${appointment.patientName}, ${currentDay} ${clock}, ${appointment.doctorName}, ${appointment.durationMinutes === null ? "duration unknown" : `${appointment.durationMinutes} minutes`}`}>
          <time dateTime={appointment.scheduledAt}>{clock}</time>
          <span className={styles.schedulerAgendaIdentity}><strong>{appointment.patientName}</strong><span>{appointment.doctorName} · {appointment.appointmentTypeName ?? "Type not recorded"} · {appointment.durationMinutes === null ? "Duration unknown" : `${appointment.durationMinutes} min`}</span><span className={styles.schedulerAgendaCues}>{cues.map((cue) => <small key={cue}>{cue}</small>)}</span></span>
        </button>
      </div>;
    })}
  </section>;
}
