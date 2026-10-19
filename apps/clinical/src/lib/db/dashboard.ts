import { createClient as createServerClient } from "@/lib/supabase/server";
import { logWarn } from "@/lib/logger";
import {
  getAppointmentQueue,
  type AppointmentQueue,
} from "./appointment-queue";
import { getPendingConsultations } from "./consultations";

// Only what the doctor's Today surface actually renders. The previous shape also
// counted consultations/notes and loaded a recent list that nothing consumed —
// six extra clinic-scoped round trips on every dashboard load.
//
// The pending-review list is back, but this time something renders it: drafts now
// get generated in the background after the doctor leaves, and without a surface
// for them that recovery work would be invisible.
/**
 * Deliberately slim. The full consultation row carries consent and priority
 * metadata, none of which this surface has any business showing.
 */
export type PendingReviewItem = {
  consultationId: string;
  patientFullName: string | null;
  startedAt: string | null;
  draftPreview: string | null;
};

export type DashboardOverview = {
  totalPatients: number;
  patientsToday: number;
  todayQueue: AppointmentQueue;
  /**
   * Visits whose transcript arrived after the doctor left and were drafted in the
   * background. These are the ones the doctor would otherwise never hear about.
   */
  pendingReview: PendingReviewItem[];
  pendingReviewHasMore: boolean;
};

/**
 * Bounded on purpose. This panel is a nudge back to unfinished work, not a
 * backlog manager — a doctor sitting on forty unreviewed drafts needs a different
 * conversation, not a longer list.
 */
const PENDING_REVIEW_LIMIT = 5;

export async function getDashboardOverview(clinicId: string, doctorId: string): Promise<DashboardOverview> {
  const supabase = await createServerClient();

  const [todayQueue, patientCountResult, pendingRows] = await Promise.all([
    getAppointmentQueue(clinicId),
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
    // One extra row is the cheapest way to tell "exactly N" from "at least N"
    // without issuing a second counting query on every dashboard load.
    //
    // Non-fatal by design. Today's queue is why the doctor opened this page; an
    // optional backlog panel must not be able to blank the whole surface. Logged
    // rather than swallowed, because a silent [] is indistinguishable from
    // "nothing pending" — the exact trap the background draft sweep fell into.
    getPendingConsultations(clinicId, doctorId, PENDING_REVIEW_LIMIT + 1).catch((error) => {
      logWarn("dashboard.pending_review_unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return [];
    }),
  ]);

  if (patientCountResult.error) {
    throw new Error(`Failed to count patients: ${patientCountResult.error.message}`);
  }

  return {
    totalPatients: patientCountResult.count ?? 0,
    patientsToday: todayQueue.summary.total,
    todayQueue,
    // Normalised to an ISO string here: this value crosses into a client
    // component, and the consultation row's own type hands back a Date.
    pendingReview: pendingRows.slice(0, PENDING_REVIEW_LIMIT).map((row) => ({
      consultationId: row.id,
      patientFullName: row.patientFullName,
      startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
      draftPreview: row.draftPreview,
    })),
    pendingReviewHasMore: pendingRows.length > PENDING_REVIEW_LIMIT,
  };
}
