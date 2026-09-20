import assert from "node:assert/strict";
import test from "node:test";
import type { SchedulerAppointmentSummary } from "../lib/db/scheduler-read";
import { agendaAppointments, agendaDay, agendaOperationalCues } from "../lib/scheduler/agenda-view-model";
import { CalendarRequestGate } from "../lib/scheduler/calendar-request";
import { bookingSemanticIdentity, canPreviewBooking, displayedBookingDuration, hasValidDurationOverride, optionalDurationOverride, selectedDoctorTypeId } from "../lib/scheduler/workspace-payloads";
import { refreshPanelAppointment, selectAppointment, type SchedulerPanel } from "../lib/scheduler/panel-state";

function appointment(patch: Partial<SchedulerAppointmentSummary> = {}): SchedulerAppointmentSummary {
  return {
    id: "a", patientId: "p", patientName: "Asha Patel", patientPhone: null, doctorId: "d", doctorName: "Dr Shah",
    scheduledAt: "2026-09-20T04:37:00Z", durationMinutes: 7, durationState: "known", status: "scheduled",
    appointmentTypeName: "Follow-up", encounterOperationalStatus: "waiting", intakeStatus: "submitted",
    documentStatus: "needs_review", updatedAt: "2026-09-20T04:00:00Z", ...patch,
  };
}

test("Phase 4 booking, search and inspector share one exclusive panel state", () => {
  let panel: SchedulerPanel = { kind: "none" };
  panel = { kind: "booking", prefill: { doctorId: "d", date: "2026-09-20", time: "09:07" } };
  assert.deepEqual(panel.prefill, { doctorId: "d", date: "2026-09-20", time: "09:07" });
  panel = { kind: "patient-search" };
  assert.equal(panel.kind, "patient-search");
  panel = selectAppointment(appointment());
  assert.equal(panel.kind, "appointment");
  panel = refreshPanelAppointment(panel, appointment({ id: "other" }));
  assert.equal(panel.kind === "appointment" ? panel.appointment.id : null, "a");
});

test("Phase 4 preview requires patient, options duration and a real exact-minute time", () => {
  const selection = { patientId: "p", doctorId: "d", date: "2026-09-20", time: "09:07", duration: 7, validOverride: true };
  assert.equal(canPreviewBooking(selection), true);
  assert.equal(canPreviewBooking({ ...selection, patientId: undefined }), false);
  assert.equal(canPreviewBooking({ ...selection, doctorId: "" }), false);
  assert.equal(canPreviewBooking({ ...selection, duration: null }), false);
  assert.equal(canPreviewBooking({ ...selection, duration: 4 }), false);
  assert.equal(canPreviewBooking({ ...selection, duration: 5.5 }), false);
  assert.equal(canPreviewBooking({ ...selection, validOverride: false }), false);
  assert.equal(canPreviewBooking({ ...selection, date: "2026-02-30" }), false);
  assert.equal(canPreviewBooking({ ...selection, time: "25:90" }), false);
});

test("Phase 4 duration retains server defaults, type default, exact-minute override and doctor type reset", () => {
  const appointmentTypes = [{ id: "followup", resolvedDurationMinutes: 10 }, { id: "new", resolvedDurationMinutes: 30 }];
  assert.equal(displayedBookingDuration({ typeId: "", appointmentTypes, effectiveDefaultDurationMinutes: 5 }), 5);
  assert.equal(displayedBookingDuration({ typeId: "followup", appointmentTypes, effectiveDefaultDurationMinutes: 5 }), 10);
  assert.equal(displayedBookingDuration({ typeId: "new", appointmentTypes, effectiveDefaultDurationMinutes: 15 }), 30);
  assert.equal(displayedBookingDuration({ typeId: "", appointmentTypes, effectiveDefaultDurationMinutes: 15 }), 15);
  assert.equal(optionalDurationOverride("7"), 7);
  assert.equal(optionalDurationOverride(""), undefined);
  assert.equal(hasValidDurationOverride("7.5"), false);
  assert.equal(selectedDoctorTypeId("followup", ["other"]), "");
  assert.equal(selectedDoctorTypeId("followup", ["followup"]), "followup");
});

test("Phase 4 semantic changes demand new preview/acknowledgements and discard late results", async () => {
  const fields = { patientId: "p", doctorId: "d", date: "2026-09-20", time: "09:07", typeId: "followup", durationOverride: "", staffNote: "" };
  const original = bookingSemanticIdentity(fields);
  for (const change of [{ patientId: "other" }, { doctorId: "other" }, { date: "2026-09-21" }, { time: "09:22" }, { typeId: "new" }, { durationOverride: "7" }, { staffNote: "Updated" }]) {
    assert.notEqual(bookingSemanticIdentity({ ...fields, ...change }), original);
  }
  const gate = new CalendarRequestGate();
  const old = gate.start();
  let displayed = "";
  let release!: () => void;
  const stale = new Promise<void>((resolve) => { release = resolve; }).then(() => { if (old.isCurrent()) displayed = "old clean preview"; });
  gate.cancel();
  const current = gate.start();
  release(); await stale;
  if (current.isCurrent()) displayed = "new conflict preview";
  assert.equal(old.signal.aborted, true);
  assert.equal(displayed, "new conflict preview");
});

test("Phase 4 Agenda orders by authoritative start, with deterministic ties and no availability filtering", () => {
  const rows = [appointment({ id: "late", scheduledAt: "2026-09-20T13:00:00Z", durationMinutes: null, durationState: "unknown" }),
    appointment({ id: "z", scheduledAt: "2026-09-20T04:37:00Z", doctorName: "Dr Rao" }),
    appointment({ id: "b", scheduledAt: "2026-09-20T04:37:00Z", doctorName: "Dr Shah", patientName: "B" }),
    appointment({ id: "a", scheduledAt: "2026-09-20T04:37:00Z", doctorName: "Dr Shah", patientName: "B" })];
  assert.deepEqual(agendaAppointments(rows).map((item) => item.id), ["z", "a", "b", "late"]);
  assert.deepEqual(rows.map((item) => item.id), ["late", "z", "b", "a"]);
  assert.equal(agendaDay(rows[0]), "2026-09-20");
  assert.deepEqual(agendaAppointments([appointment({ id: "offset", scheduledAt: "2026-09-20T09:00:00+05:30" }), appointment({ id: "later", scheduledAt: "2026-09-20T04:00:00Z" })]).map((item) => item.id), ["offset", "later"]);
});

test("Phase 4 Agenda cues use only lifecycle, readiness and operational Queue projection", () => {
  assert.deepEqual(agendaOperationalCues(appointment()), ["scheduled", "Intake ready", "Documents to review", "Waiting"]);
  assert.deepEqual(agendaOperationalCues(appointment({ intakeStatus: null, documentStatus: "ready", encounterOperationalStatus: "scheduled" })), ["scheduled", "Intake pending", "Documents ready", "Not arrived"]);
  for (const status of ["cancelled", "no_show", "completed"] as const) {
    assert.deepEqual(agendaOperationalCues(appointment({ status })), [status.replaceAll("_", " ")]);
  }
  assert.ok(!JSON.stringify(agendaOperationalCues(appointment({ patientName: "Private", patientPhone: "+919000000000" }))).includes("Private"));
});
