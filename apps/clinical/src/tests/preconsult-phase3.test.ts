import assert from "node:assert/strict";
import test from "node:test";
import {
  clinicDayBounds,
  nextOperationalStatus,
  QueueTransitionError,
  queueSummary,
  transitionAppointmentQueueWithClient,
  type AppointmentQueueItem,
} from "../lib/db/appointment-queue";
import { appointmentQueueOperationSchema } from "../lib/validation";

const scheduledItem: AppointmentQueueItem = {
  appointmentId: "40000000-0000-4000-8000-000000000001",
  consultationId: "50000000-0000-4000-8000-000000000001",
  patientId: "30000000-0000-4000-8000-000000000001",
  patientName: "Aarav Mehta",
  scheduledAt: "2026-08-30T04:30:00.000Z",
  checkedInAt: null,
  queueOrder: null,
  appointmentStatus: "scheduled",
  operationalStatus: "scheduled",
  visitType: "new",
  intakeStatus: "not_started",
  intakeLastSentAt: null,
  intakeAccessStatus: "not_sent",
  intakeAccessExpiresAt: null,
  documentStatus: "none",
  documentCount: 0,
  isPriority: false,
  priorityUpdatedByName: null,
  priorityUpdatedByRole: null,
  priorityUpdatedAt: null,
  priorityReason: null,
};

test("today queue uses India Standard Time day boundaries", () => {
  const bounds = clinicDayBounds(new Date("2026-08-30T20:00:00.000Z"));
  assert.equal(bounds.start, "2026-08-30T18:30:00.000Z");
  assert.equal(bounds.end, "2026-08-31T18:30:00.000Z");
});

test("queue operations preserve non-blocking arrival and doctor start paths", () => {
  assert.equal(nextOperationalStatus("scheduled", "mark_arrived"), "arrived");
  assert.equal(nextOperationalStatus("arrived", "mark_waiting"), "waiting");
  assert.equal(nextOperationalStatus("scheduled", "start_consultation"), "in_consultation");
  assert.equal(nextOperationalStatus("waiting", "start_consultation"), "in_consultation");
  assert.equal(nextOperationalStatus("scheduled", "mark_waiting"), null);
  assert.equal(nextOperationalStatus("waiting", "mark_arrived"), null);
  assert.equal(nextOperationalStatus("completed", "start_consultation"), null);
});

test("queue transition service delegates one atomic RPC and maps its result", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: [{
          consultation_id: scheduledItem.consultationId,
          operational_status: "arrived",
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof transitionAppointmentQueueWithClient>[0];

  const result = await transitionAppointmentQueueWithClient(
    client,
    scheduledItem.appointmentId,
    "mark_arrived"
  );

  assert.equal(rpcName, "transition_appointment_queue");
  assert.deepEqual(rpcArgs, {
    p_appointment_id: scheduledItem.appointmentId,
    p_operation: "mark_arrived",
  });
  assert.deepEqual(result, {
    consultationId: scheduledItem.consultationId,
    operationalStatus: "arrived",
  });
});

test("queue transition service maps database authorization and state failures", async () => {
  for (const [code, kind] of [
    ["42501", "forbidden"],
    ["P0002", "not_found"],
    ["22023", "invalid_state"],
  ] as const) {
    const client = {
      async rpc() {
        return { data: null, error: { code } };
      },
    } as unknown as Parameters<typeof transitionAppointmentQueueWithClient>[0];

    await assert.rejects(
      transitionAppointmentQueueWithClient(client, scheduledItem.appointmentId, "mark_arrived"),
      (error: unknown) => error instanceof QueueTransitionError && error.kind === kind
    );
  }
});

test("queue summaries exclude cancelled appointments from operational readiness counts", () => {
  const items: AppointmentQueueItem[] = [
    scheduledItem,
    { ...scheduledItem, appointmentId: "40000000-0000-4000-8000-000000000002", operationalStatus: "waiting" },
    {
      ...scheduledItem,
      appointmentId: "40000000-0000-4000-8000-000000000003",
      appointmentStatus: "cancelled",
      operationalStatus: "scheduled",
    },
  ];

  assert.deepEqual(queueSummary(items), {
    total: 3,
    scheduled: 1,
    arrived: 0,
    waiting: 1,
    inConsultation: 0,
    intakePending: 2,
    processing: 0,
    needsReview: 0,
    priority: 0,
    completed: 0,
    needsAction: 2,
  });
});

test("queue operation validation accepts only explicit operational actions", () => {
  assert.equal(
    appointmentQueueOperationSchema.safeParse({ operation: "mark_arrived" }).success,
    true
  );
  assert.equal(
    appointmentQueueOperationSchema.safeParse({ operation: "approve_note" }).success,
    false
  );
});
