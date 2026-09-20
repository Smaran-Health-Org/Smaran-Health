"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/components/clinical.module.css";
import type { SchedulerAppointmentSummary, SchedulerPatientHistory, SchedulerPatientSearchResult } from "@/lib/db/scheduler-read";
import { CalendarRequestGate } from "@/lib/scheduler/calendar-request";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export function SchedulerPatientSearch({ role, onSelectAppointment }: {
  role: "doctor" | "admin" | "assistant";
  onSelectAppointment: (appointment: SchedulerAppointmentSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchedulerPatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<SchedulerPatientSearchResult | null>(null);
  const [history, setHistory] = useState<SchedulerPatientHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchGate = useRef(new CalendarRequestGate());
  const historyController = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const gate = searchGate.current; inputRef.current?.focus(); return () => { gate.cancel(); historyController.current?.abort(); }; }, []);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const gate = searchGate.current;
    const request = gate.start();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/scheduler/search?q=${encodeURIComponent(query.trim())}`, { signal: request.signal });
        if (!response.ok) throw new Error("Could not search patients. Try again.");
        const payload = await response.json() as { data?: SchedulerPatientSearchResult[] };
        if (!Array.isArray(payload.data)) throw new Error("Invalid search response");
        if (!request.isCurrent()) return;
        setResults(payload.data);
        setLoading(false);
      } catch {
        if (!request.isCurrent()) return;
        setError("Could not search patients. Try again.");
        setLoading(false);
      }
    }, 250);
    return () => { gate.cancel(); window.clearTimeout(timer); };
  }, [query]);

  function changeQuery(value: string) {
    searchGate.current.cancel();
    historyController.current?.abort();
    setQuery(value);
    setResults([]);
    setSelectedPatient(null);
    setHistory(null);
    setHistoryLoading(false);
    setError(null);
    setLoading(value.trim().length >= 2);
  }

  async function choosePatient(patient: SchedulerPatientSearchResult) {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    setSelectedPatient(patient);
    setHistory(null);
    setError(null);
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/scheduler/search?patientId=${encodeURIComponent(patient.id)}&limit=20`, { signal: controller.signal });
      if (!response.ok) throw new Error("Could not load scheduling history. Try again.");
      const payload = await response.json() as { data?: SchedulerPatientHistory };
      if (!Array.isArray(payload.data?.upcoming) || !Array.isArray(payload.data?.past)) throw new Error("Invalid history response");
      if (!controller.signal.aborted) setHistory(payload.data);
    } catch {
      if (!controller.signal.aborted) setError("Could not load scheduling history. Try again.");
    } finally { if (!controller.signal.aborted) setHistoryLoading(false); }
  }

  return <div className={styles.schedulerSideBody}>
    <label className={styles.formField}><span>Find patient by name or phone</span><input ref={inputRef} type="search" value={query} onChange={(event) => changeQuery(event.target.value)} aria-label="Find patient by name or phone" /></label>
    {query.trim().length < 2 ? <p>Enter at least two characters.</p> : null}
    {loading ? <p role="status">Searching patients…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!loading && query.trim().length >= 2 && results.length === 0 && !error ? <p>No matching patients.</p> : null}
    {results.length ? <section aria-label="Patient search results" className={styles.schedulerSideList}>{results.map((patient) =>
      <button key={patient.id} type="button" onClick={() => void choosePatient(patient)} aria-label={`Show scheduling history for ${patient.fullName}${patient.phone ? `, ${patient.phone}` : ""}`}>
        <strong>{patient.fullName}</strong><span>{patient.phone ?? "Phone not recorded"}</span>
      </button>)}</section> : null}
    {selectedPatient ? <section aria-label={`Scheduling history for ${selectedPatient.fullName}`} className={styles.schedulerSearchHistory}>
      <h3>{selectedPatient.fullName}</h3>
      <a href={role === "doctor" ? `/patients/${selectedPatient.id}` : `/desk/patients/${selectedPatient.id}`}>View patient</a>
      {historyLoading ? <p role="status">Loading scheduling history…</p> : null}
      {history ? <>
        <HistoryGroup title="Upcoming" items={history.upcoming} onSelect={onSelectAppointment} />
        <HistoryGroup title="Past" items={history.past} onSelect={onSelectAppointment} />
      </> : null}
    </section> : null}
  </div>;
}

function HistoryGroup({ title, items, onSelect }: { title: string; items: SchedulerAppointmentSummary[]; onSelect: (item: SchedulerAppointmentSummary) => void }) {
  return <div className={styles.schedulerSideList}><h4>{title}</h4>{items.length ? items.map((item) =>
    <button key={item.id} type="button" onClick={() => onSelect(item)} aria-label={`Open ${item.status.replaceAll("_", " ")} appointment for ${item.patientName}, ${dateFormatter.format(new Date(item.scheduledAt))}`}>
      <strong>{dateFormatter.format(new Date(item.scheduledAt))}</strong>
      <span>{item.doctorName} · {item.appointmentTypeName ?? "Type not recorded"}</span>
      <span>{item.durationMinutes === null ? "Duration unknown" : `${item.durationMinutes} min`} · {item.status.replaceAll("_", " ")}</span>
    </button>) : <p>No {title.toLowerCase()} appointments.</p>}</div>;
}
