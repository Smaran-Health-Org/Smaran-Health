import assert from "node:assert/strict";
import test from "node:test";
import type { SchedulerAppointmentSummary } from "../lib/db/scheduler-read";
import { getSchedulerAppointmentWithClient, getSchedulerPatientHistoryWithClient, SchedulerReadError, searchSchedulerPatientsWithClient } from "../lib/db/scheduler-read";
import { CalendarRequestGate } from "../lib/scheduler/calendar-request";
import { calendarOperationalSummary, visibleCalendarDoctors } from "../lib/scheduler/calendar-view-model";
import { refreshPanelAppointment, selectAppointment, type SchedulerPanel } from "../lib/scheduler/panel-state";
import { inspectorActions, inspectorOriginLabel, inspectorQueueLabel } from "../lib/scheduler/inspector-view-model";
import type { SessionContext } from "../types";

const staff: SessionContext = { userId: "actor", profileId: "actor", clinicId: "clinic-a", email: "staff@example.test", fullName: "Staff", role: "assistant", accessState: "active", ownerDoctorId: null };
const appointment = (patch: Partial<SchedulerAppointmentSummary> = {}): SchedulerAppointmentSummary => ({
  id: "appointment-1", patientId: "patient-1", patientName: "Asha Patel", patientPhone: null,
  doctorId: "doctor-1", doctorName: "Dr Shah", scheduledAt: "2026-09-20T04:30:00Z", durationMinutes: 15,
  durationState: "known", status: "scheduled", appointmentTypeName: "Follow-up", encounterOperationalStatus: "scheduled",
  intakeStatus: "not_started", documentStatus: "none", origin: "clinic_booking", updatedAt: "2026-09-20T04:00:00Z", ...patch,
});

test("Phase 3 panel modes are exclusive, second selection replaces the first, and refresh ignores obsolete selection", () => {
  let panel: SchedulerPanel = { kind: "none" };
  panel = selectAppointment(appointment());
  assert.equal(panel.kind, "appointment");
  panel = selectAppointment(appointment({ id: "appointment-2" }));
  assert.equal(panel.kind, "appointment");
  assert.equal(panel.kind === "appointment" ? panel.appointment.id : null, "appointment-2");
  panel = refreshPanelAppointment(panel, appointment({ id: "appointment-1", updatedAt: "later" }));
  assert.equal(panel.kind === "appointment" ? panel.appointment.id : null, "appointment-2");
  panel = { kind: "patient-search" };
  assert.equal(panel.kind, "patient-search");
  panel = selectAppointment(appointment({ id: "history-1" }));
  assert.equal(panel.kind === "appointment" ? panel.appointment.id : null, "history-1");
  panel = { kind: "none" };
  assert.equal(panel.kind, "none");
});

test("Phase 3 search discards an older response even when abort is ignored", async () => {
  const gate = new CalendarRequestGate();
  const first = gate.start();
  let results = "";
  let release!: () => void;
  const late = new Promise<void>((resolve) => { release = resolve; }).then(() => { if (first.isCurrent()) results = "Ne"; });
  gate.cancel(); // Query changed before the first network result arrived.
  const latest = gate.start();
  release();
  await late;
  if (latest.isCurrent()) results = "Neha";
  assert.equal(results, "Neha");
  assert.equal(first.signal.aborted, true);
});

test("Phase 3 search requires a useful query and foreign-patient history is rejected", async () => {
  await assert.rejects(searchSchedulerPatientsWithClient({} as never, staff, { query: "N", limit: 20 }),
    (error: unknown) => error instanceof SchedulerReadError && error.kind === "invalid");
  const foreignClient = { from: () => {
    const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: () => ({ data: null, error: null }) };
    return query;
  } } as never;
  await assert.rejects(getSchedulerPatientHistoryWithClient(foreignClient, staff, { patientId: "foreign-patient", limit: 20 }),
    (error: unknown) => error instanceof SchedulerReadError && error.kind === "not_found");
});

test("Phase 3 summary counts only scheduled records in the visible provider scope", () => {
  const rows = [appointment(), appointment({ id: "a2", doctorId: "doctor-2", intakeStatus: "submitted", encounterOperationalStatus: "waiting" }),
    appointment({ id: "a3", doctorId: "doctor-3", status: "cancelled", encounterOperationalStatus: "waiting" }),
    appointment({ id: "a4", doctorId: "doctor-1", status: "no_show" })];
  const scoped = (ids: string[]) => calendarOperationalSummary(rows.filter((item) => ids.includes(item.doctorId)));
  assert.deepEqual(scoped(visibleCalendarDoctors("day", ["doctor-1"], "doctor-1")), { appointments: 1, intakePending: 1, waiting: 0 });
  assert.deepEqual(scoped(visibleCalendarDoctors("day", ["doctor-1", "doctor-2", "doctor-3"], "doctor-1")), { appointments: 2, intakePending: 1, waiting: 1 });
  assert.deepEqual(scoped(visibleCalendarDoctors("week", ["doctor-1", "doctor-2"], "doctor-2")), { appointments: 1, intakePending: 0, waiting: 1 });
});

test("Phase 3 inspector keeps lifecycle, Queue and action eligibility separate", () => {
  const scheduled = appointment({ encounterOperationalStatus: "scheduled" });
  assert.deepEqual(inspectorActions(scheduled, "assistant"), {
    sendLink: true, reschedule: true, reassign: false, cancel: true, noShow: true,
    rebook: false, remediate: false, markArrived: true, markWaiting: false,
    checkIn: true, startConsultation: false,
  });
  assert.equal(inspectorActions(scheduled, "doctor").reassign, true);
  // Only a doctor may open the encounter from the schedule, and check-in is
  // an operational action available to every permitted scheduler role.
  assert.equal(inspectorActions(scheduled, "doctor").startConsultation, true);
  assert.equal(inspectorActions(scheduled, "admin").startConsultation, false);
  assert.equal(inspectorActions(appointment({ encounterOperationalStatus: "waiting" }), "doctor").checkIn, false);
  assert.equal(inspectorActions(appointment({ status: "cancelled" }), "doctor").startConsultation, false);
  assert.equal(inspectorActions(appointment({ durationMinutes: null, durationState: "unknown" }), "doctor").reschedule, false);
  assert.equal(inspectorActions(appointment({ durationMinutes: null, durationState: "unknown" }), "doctor").remediate, true);
  assert.equal(inspectorActions(appointment({ encounterOperationalStatus: "arrived" }), "assistant").markWaiting, true);
  assert.equal(inspectorActions(appointment({ encounterOperationalStatus: "waiting" }), "assistant").markArrived, false);
  for (const status of ["cancelled", "no_show", "completed"] as const) {
    const actions = inspectorActions(appointment({ status, encounterOperationalStatus: "arrived" }), "doctor");
    assert.equal(actions.cancel, false);
    assert.equal(actions.markWaiting, false);
    assert.equal(actions.rebook, status !== "completed");
  }
  assert.equal(inspectorQueueLabel("scheduled"), "Not arrived");
  assert.equal(inspectorQueueLabel("arrived"), "Checked in");
  assert.equal(inspectorQueueLabel("waiting"), "Waiting");
  assert.equal(inspectorQueueLabel("in_consultation"), "With doctor");
  assert.equal(inspectorOriginLabel("walk_in"), "Walk-in");
  assert.equal(inspectorOriginLabel("patient_portal"), "Online booking");
  assert.equal(inspectorOriginLabel("clinic_booking"), "Clinic booking");
});

test("Phase 3 inspector read is clinic-scoped and has an exact scheduling-only payload", async () => {
  const selected: Array<[string, string]> = [];
  const filters: Array<[string, string, unknown]> = [];
  const raw = { id: "appointment-1", patient_id: "patient-1", doctor_id: "doctor-1", consultation_id: "encounter-1", scheduled_at: "2026-09-20T04:30:00Z", duration_minutes: 15, status: "scheduled", appointment_type_id: null, updated_at: "2026-09-20T04:00:00Z", staff_note: "private" };
  const client = {
    from(table: string) {
      let clinic = "";
      const query = {
        select: (columns: string) => { selected.push([table, columns]); return query; },
        eq: (column: string, value: unknown) => { filters.push([table, column, value]); if (column === "clinic_id") clinic = String(value); return query; },
        in: () => query,
        maybeSingle: () => ({ data: table === "appointments" && clinic === "clinic-a" ? raw : null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "patients" ? [{ id: "patient-1", full_name: "Asha Patel", phone: null, medical_brief: "private" }] : table === "profiles" ? [{ id: "doctor-1", full_name: "Dr Shah" }] : table === "consultations" ? [{ id: "encounter-1", operational_status: "waiting", clinical_note: "private" }] : table === "documents" ? [{ consultation_id: "encounter-1", status: "uploaded" }, { consultation_id: "encounter-1", status: "processed" }] : [], error: null }).then(resolve),
      };
      return query;
    },
    rpc(name: string) {
      assert.equal(name, "get_intake_operational_statuses");
      return Promise.resolve({ data: [{ consultation_id: "encounter-1", intake_status: "submitted" }], error: null });
    },
  } as never;
  const result = await getSchedulerAppointmentWithClient(client, staff, "appointment-1");
  assert.equal(result.encounterOperationalStatus, "waiting");
  assert.equal(result.documentStatus, "needs_review");
  assert.deepEqual(Object.keys(result).sort(), Object.keys(appointment()).sort());
  assert.ok(filters.some(([table, column, value]) => table === "appointments" && column === "clinic_id" && value === "clinic-a"));
  assert.ok(filters.some(([table, column, value]) => table === "appointments" && column === "id" && value === "appointment-1"));
  for (const [, columns] of selected) assert.doesNotMatch(columns, /staff_note|clinical_note|medical_brief|diagnos|medication|filename|content|payload|audit/i);
  assert.doesNotMatch(JSON.stringify(result), /private|clinical|staff_note|medical_brief|audit/i);
  await assert.rejects(getSchedulerAppointmentWithClient(client, { ...staff, clinicId: "clinic-b" }, "appointment-1"), (error: unknown) => error instanceof SchedulerReadError && error.kind === "not_found");
  await assert.rejects(getSchedulerAppointmentWithClient(client, { ...staff, role: "patient" as SessionContext["role"] }, "appointment-1"), (error: unknown) => error instanceof SchedulerReadError && error.kind === "forbidden");
});
