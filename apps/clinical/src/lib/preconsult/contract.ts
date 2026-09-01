import { createHash } from "node:crypto";
import { z } from "zod";

export const PRECONSULT_BRIEF_SCHEMA_VERSION = "preconsult-brief/v1";
export const PRECONSULT_SELECTION_CONTRACT_VERSION = "preconsult-source-allowlist/v1";
export const PRECONSULT_GENERATOR_VERSION = "deterministic/v1";
const verificationState = z.enum(["confirmed", "proposed", "patient_reported_unconfirmed", "external_unconfirmed", "needs_review"]);
const sourceRef = z.object({ type: z.enum(["document", "observation", "intake_statement", "delta", "state_version", "clinical_note"]), id: z.string().uuid(), page: z.number().int().positive().nullable().optional(), itemIndex: z.number().int().nonnegative().nullable().optional() });
export const briefClaim = z.object({ id: z.string().min(1).max(200), text: z.string().min(1).max(1200), verification: verificationState, sources: z.array(sourceRef).min(1) });
export const reviewItem = z.object({ id: z.string().min(1).max(200), text: z.string().min(1).max(600), verification: z.enum(["proposed", "needs_review"]), sources: z.array(sourceRef).min(1) });
export const preconsultBriefSchema = z.object({ schemaVersion: z.literal(PRECONSULT_BRIEF_SCHEMA_VERSION), mode: z.enum(["returning", "no_baseline"]), whyToday: z.object({ verbatim: z.string().nullable(), provenance: z.enum(["patient", "reception_assisted", "unknown"]), secondaryCompression: z.string().max(300).optional() }), changes: z.array(briefClaim), patientOverview: z.array(briefClaim), needsAttention: z.array(reviewItem), alreadyKnown: z.object({ lastVisit: z.object({ consultationId: z.string().uuid(), date: z.string(), summary: z.string().nullable() }).nullable(), approvedMemory: z.array(briefClaim) }), evidenceSummary: z.array(sourceRef) });
export type PreconsultBrief = z.infer<typeof preconsultBriefSchema>;
export type PreconsultBriefLifecycle = "ready" | "partial" | "updating" | "unavailable";
export function hasActivePreconsultGenerationWork(status: string): boolean { return status === "pending" || status === "processing" || status === "retryable_failed"; }
export function derivePreconsultBriefLifecycle(input: { hasArtifact: boolean; resultState?: "ready" | "partial"; hasActiveWork: boolean }): PreconsultBriefLifecycle {
  if (!input.hasArtifact) return "unavailable";
  if (input.hasActiveWork) return "updating";
  return input.resultState === "partial" ? "partial" : "ready";
}
export type PreconsultTrendPoint = { observationId: string; displayName: string; normalizedKey: string; value: number; valueText: string; unit: string; referenceRange: string | null; effectiveDate: string; datePrecision: "unknown" | "exact" | "approximate"; sourceDocumentId: string; sourcePageNumber: number | null; originalValueText: string; corrected: boolean; correctionId: string | null };
export type PreconsultTrendGroup = { id: string; displayName: string; normalizedKey: string; unit: string; recentPoints: PreconsultTrendPoint[]; allPoints: PreconsultTrendPoint[] };
export function buildComparableTrendGroups(points: PreconsultTrendPoint[], relevantObservationIds: string[]): PreconsultTrendGroup[] {
  const groups = new Map<string, PreconsultTrendPoint[]>();
  for (const point of points) { const key = `${point.normalizedKey}\u0000${point.unit}`; groups.set(key, [...(groups.get(key) ?? []), point]); }
  return [...groups.entries()].flatMap(([key, group]) => {
    const ordered = [...group].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.observationId.localeCompare(b.observationId));
    if (ordered.length < 2 || !ordered.some((point) => relevantObservationIds.includes(point.observationId))) return [];
    return [{ id: `trend:${key}`, displayName: ordered[0].displayName, normalizedKey: ordered[0].normalizedKey, unit: ordered[0].unit, recentPoints: ordered.slice(-6), allPoints: ordered }];
  });
}
function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function preconsultSourceWatermark(sourceManifest: Record<string, unknown>): string { return createHash("sha256").update(stableJson(sourceManifest)).digest("hex"); }
export function selectPriorApprovedBaseline<T extends { id: string; started_at: string }, N extends { consultation_id: string }>(visits: T[], notes: N[]): { visit: T; note: N } | null { const notesByConsultation = new Map(notes.map((note) => [note.consultation_id, note])); for (const visit of [...visits].sort((a, b) => b.started_at.localeCompare(a.started_at))) { const note = notesByConsultation.get(visit.id); if (note) return { visit, note }; } return null; }
export function isReturningChange(input: { baselineStartedAt: string; currentConsultationId: string; observationConsultationId?: string | null; observationEffectiveDate?: string | null; confirmedAt?: string | null; createdAt?: string | null }): boolean {
  if (input.observationConsultationId === input.currentConsultationId) return true;
  if (input.observationEffectiveDate) return input.observationEffectiveDate >= input.baselineStartedAt.slice(0, 10);
  return Boolean(input.confirmedAt && input.confirmedAt > input.baselineStartedAt) || Boolean(input.createdAt && input.createdAt > input.baselineStartedAt);
}
