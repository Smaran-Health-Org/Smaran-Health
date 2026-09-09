import { z } from "zod";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { recordPreconsultBriefViewWithClient } from "./brief-view";

export { recordPreconsultBriefViewWithClient } from "./brief-view";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PRECONSULT_BRIEF_SCHEMA_VERSION, PRECONSULT_GENERATOR_VERSION, PRECONSULT_SELECTION_CONTRACT_VERSION, preconsultBriefSchema, preconsultSourceWatermark, selectPriorApprovedBaseline, isReturningChange, buildComparableTrendGroups, type PreconsultBrief, type PreconsultBriefLifecycle, type PreconsultTrendGroup, type PreconsultTrendPoint, briefClaim } from "@/lib/preconsult/contract";
import {
  resolvePreconsultBriefAtConsultationStart,
  type PreconsultBriefAtConsultationStart,
  type PreconsultBriefStartContext,
  type PreconsultBriefStartSnapshotRecord,
  type PreconsultBriefVersionRecord,
} from "@/lib/preconsult/consultation-start";
export { PRECONSULT_BRIEF_SCHEMA_VERSION, PRECONSULT_GENERATOR_VERSION, PRECONSULT_SELECTION_CONTRACT_VERSION, preconsultBriefSchema, preconsultSourceWatermark, selectPriorApprovedBaseline, isReturningChange, buildComparableTrendGroups, hasActivePreconsultGenerationWork, type PreconsultBrief, type PreconsultBriefLifecycle, type PreconsultTrendGroup, type PreconsultTrendPoint } from "@/lib/preconsult/contract";
export {
  resolvePreconsultBriefAtConsultationStart,
  preconsultVerificationLabel,
  type PreconsultBriefAtConsultationStart,
  type PreconsultBriefStartContext,
  type PreconsultBriefStartSnapshotRecord,
  type PreconsultBriefVersionRecord,
} from "@/lib/preconsult/consultation-start";

export type PreconsultArtifact = { id: string; resultState: "ready" | "partial"; sourceWatermark: string; generatedAt: string; payload: PreconsultBrief };
type RecordRow = Record<string, unknown>;

function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function approvedText(value: unknown): string | null { const text = stringValue(value); return text && text !== "None." && text !== "None stated." ? text : null; }

function stateClaim(row: RecordRow): z.infer<typeof briefClaim> {
  const value = (row.value_json ?? {}) as Record<string, unknown>;
  const name = stringValue(value.displayName) ?? "Confirmed clinical information";
  const detail = stringValue(value.valueText);
  return { id: `state:${String(row.id)}`, text: detail ? `${name}: ${detail}` : name, verification: "confirmed", sources: [{ type: "state_version", id: String(row.id) }] };
}

function observationClaim(row: RecordRow): z.infer<typeof briefClaim> {
  const correction = row.correction as RecordRow | undefined;
  const value = (correction?.corrected_normalized_value ?? row.normalized_value ?? {}) as Record<string, unknown>;
  const name = stringValue(correction?.corrected_display_name) ?? stringValue(row.display_name) ?? "External observation";
  const detail = stringValue(value.valueText);
  const sources: z.infer<typeof briefClaim>["sources"] = [{ type: "observation", id: String(row.id), page: typeof row.source_page_number === "number" ? row.source_page_number : null }];
  if (typeof row.source_document_id === "string") sources.push({ type: "document", id: row.source_document_id, page: typeof row.source_page_number === "number" ? row.source_page_number : null });
  return { id: `observation:${String(row.id)}`, text: detail ? `${name}: ${detail}` : name, verification: "external_unconfirmed", sources };
}

async function sourcePacket(client: ReturnType<typeof createServiceRoleClient>, consultationId: string) {
  const { data: consultation, error } = await client.from("consultations").select("id,clinic_id,patient_id,started_at,operational_status,patients!inner(full_name)").eq("id", consultationId).maybeSingle();
  if (error || !consultation) throw new Error("preconsult_source_unavailable");
  const current = consultation as RecordRow;
  const clinicId = String(current.clinic_id); const patientId = String(current.patient_id); const visitAt = String(current.started_at);
  const [intakeRes, historyRes, stateRes, deltaRes, observationRes, documentRes, correctionRes] = await Promise.all([
    client.from("patient_intake_statements").select("id,reason_for_visit_raw,information_source,entered_via,self_reported_conditions,self_reported_medications,self_reported_allergies,created_at").eq("consultation_id", consultationId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    client.from("consultations").select("id,started_at").eq("clinic_id", clinicId).eq("patient_id", patientId).eq("status", "approved").neq("id", consultationId).lt("started_at", visitAt).order("started_at", { ascending: false }).order("id", { ascending: false }),
    client.from("current_confirmed_clinical_state").select("id,value_json,confirmed_at").eq("clinic_id", clinicId).eq("patient_id", patientId).order("confirmed_at", { ascending: false }).order("id", { ascending: false }),
    client.from("clinical_state_delta_status").select("id,classification,proposed_value_json,created_at").eq("clinic_id", clinicId).eq("patient_id", patientId).eq("status", "pending").order("created_at", { ascending: false }).order("id", { ascending: false }),
    client.from("clinical_observation_trend_inputs").select("id,consultation_id,display_name,normalized_value,source_document_id,source_page_number,effective_date,effective_date_precision,created_at").eq("clinic_id", clinicId).eq("patient_id", patientId).order("effective_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(24),
    client.from("documents").select("id,status,document_type,document_date,updated_at").eq("clinic_id", clinicId).eq("patient_id", patientId).eq("status", "needs_review").order("updated_at", { ascending: false }).order("id", { ascending: false }),
    client.from("current_clinical_observation_corrections").select("id,source_observation_id,corrected_display_name,corrected_normalized_value,corrected_at").eq("clinic_id", clinicId).eq("patient_id", patientId).order("corrected_at", { ascending: false }).order("id", { ascending: false }),
  ]);
  if ([intakeRes, historyRes, stateRes, deltaRes, observationRes, documentRes, correctionRes].some((result) => result.error)) throw new Error("preconsult_source_unavailable");
  const history = (historyRes.data ?? []) as RecordRow[];
  const historicalIds = history.map((row) => String(row.id));
  const notesRes = historicalIds.length ? await client.from("clinical_notes").select("id,consultation_id,content,status,approved_at").eq("clinic_id", clinicId).eq("status", "approved").in("consultation_id", historicalIds).order("approved_at", { ascending: false }).order("id", { ascending: false }) : { data: [], error: null };
  if (notesRes.error) throw new Error("preconsult_source_unavailable");
  const notes = (notesRes.data ?? []) as RecordRow[];
  const baseline = selectPriorApprovedBaseline(history as Array<RecordRow & { id: string; started_at: string }>, notes as Array<RecordRow & { consultation_id: string }>);
  const corrections = new Map(((correctionRes.data ?? []) as RecordRow[]).map((row) => [String(row.source_observation_id), row]));
  const observations: RecordRow[] = ((observationRes.data ?? []) as RecordRow[]).map((row) => ({ ...row, correction: corrections.get(String(row.id)) }));
  return { current, clinicId, patientId, intake: ((intakeRes.data ?? []) as RecordRow[])[0] ?? null, baseline, state: (stateRes.data ?? []) as RecordRow[], deltas: (deltaRes.data ?? []) as RecordRow[], observations, documents: (documentRes.data ?? []) as RecordRow[] };
}

function buildBrief(packet: Awaited<ReturnType<typeof sourcePacket>>) {
  const sourceManifest = {
    consultationId: String(packet.current.id), intakeId: packet.intake?.id ?? null,
    baselineNoteId: packet.baseline?.note.id ?? null,
    baselineNoteContentHash: packet.baseline ? preconsultSourceWatermark({ content: packet.baseline.note.content, approvedAt: packet.baseline.note.approved_at ?? null }) : null,
    intake: packet.intake ? { id: packet.intake.id, createdAt: packet.intake.created_at, reason: packet.intake.reason_for_visit_raw, source: packet.intake.information_source, conditions: packet.intake.self_reported_conditions, medications: packet.intake.self_reported_medications, allergies: packet.intake.self_reported_allergies } : null,
    stateIds: packet.state.map((row) => row.id).sort(), deltaIds: packet.deltas.map((row) => row.id).sort(),
    observationIds: packet.observations.map((row) => `${String(row.id)}:${String((row.correction as RecordRow | undefined)?.id ?? "original")}`).sort(), needsReviewDocumentIds: packet.documents.map((row) => row.id).sort(),
  };
  const watermark = preconsultSourceWatermark(sourceManifest);
  const intake = packet.intake;
  const whyToday = { verbatim: intake ? stringValue(intake.reason_for_visit_raw) : null, provenance: intake?.information_source === "patient" ? "patient" as const : intake ? "reception_assisted" as const : "unknown" as const };
  const intakeOverview: z.infer<typeof briefClaim>[] = intake ? [
    ["condition", "self_reported_conditions"], ["medication", "self_reported_medications"], ["allergy", "self_reported_allergies"],
  ].flatMap(([kind, key]) => {
    const items = (intake[key] ?? []) as unknown[];
    return items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item, itemIndex) => ({
      id: `intake:${String(intake.id)}:${kind}:${itemIndex}`, text: item.trim(), verification: "patient_reported_unconfirmed" as const,
      sources: [{ type: "intake_statement" as const, id: String(intake.id), itemIndex }],
    }));
  }) : [];
  const baselineStartedAt = packet.baseline?.visit.started_at;
  const changes = !baselineStartedAt ? [] : [
    ...packet.deltas.filter((row) => isReturningChange({ baselineStartedAt, currentConsultationId: String(packet.current.id), createdAt: stringValue(row.created_at) })).map((row) => { const value = (row.proposed_value_json ?? {}) as RecordRow; const label = stringValue(value.displayName) ?? "Proposed clinical change"; return { id: `delta:${String(row.id)}`, text: `${label} requires doctor review`, verification: "proposed" as const, sources: [{ type: "delta" as const, id: String(row.id) }] }; }),
    ...packet.observations.filter((row) => isReturningChange({ baselineStartedAt, currentConsultationId: String(packet.current.id), observationConsultationId: stringValue(row.consultation_id), observationEffectiveDate: stringValue(row.effective_date) })).map(observationClaim),
    ...packet.state.filter((row) => isReturningChange({ baselineStartedAt, currentConsultationId: String(packet.current.id), confirmedAt: stringValue(row.confirmed_at) })).map(stateClaim),
  ];
  const needsAttention = [
    ...packet.deltas.map((row) => ({ id: `review:delta:${String(row.id)}`, text: "A proposed clinical change needs a doctor decision", verification: "proposed" as const, sources: [{ type: "delta" as const, id: String(row.id) }] })),
    ...packet.documents.map((row) => ({ id: `review:document:${String(row.id)}`, text: "A document needs review", verification: "needs_review" as const, sources: [{ type: "document" as const, id: String(row.id) }] })),
  ];
  const content = (packet.baseline?.note.content ?? {}) as RecordRow;
  const summary = approvedText(content.summary);
  const approvedMemory: z.infer<typeof briefClaim>[] = [];
  if (packet.baseline) {
    for (const key of ["medicationChanges", "investigations", "followUpPlan", "patientInstructions"]) {
      const text = approvedText(content[key]);
      if (text) approvedMemory.push({ id: `note:${String(packet.baseline.note.id)}:${key}`, text, verification: "confirmed", sources: [{ type: "clinical_note", id: String(packet.baseline.note.id) }] });
    }
  }
  const brief: PreconsultBrief = {
    schemaVersion: PRECONSULT_BRIEF_SCHEMA_VERSION, mode: packet.baseline ? "returning" : "no_baseline", whyToday,
    changes: packet.baseline ? changes : [], patientOverview: packet.baseline ? [] : [...intakeOverview, ...packet.state.map(stateClaim), ...packet.observations.map(observationClaim)],
    needsAttention,
    alreadyKnown: { lastVisit: packet.baseline ? { consultationId: String(packet.baseline.visit.id), date: String(packet.baseline.visit.started_at), summary } : null, approvedMemory },
    evidenceSummary: [...changes, ...needsAttention, ...approvedMemory].flatMap((claim) => claim.sources),
  };
  return { brief: preconsultBriefSchema.parse(brief), sourceManifest, watermark };
}

function evidenceRows(brief: PreconsultBrief) {
  return [...brief.changes, ...brief.patientOverview, ...brief.needsAttention, ...brief.alreadyKnown.approvedMemory].flatMap((claim) => claim.sources.map((source) => ({ claim_id: claim.id,
    source_document_id: source.type === "document" ? source.id : null, source_observation_id: source.type === "observation" ? source.id : null, source_intake_statement_id: source.type === "intake_statement" ? source.id : null, source_delta_id: source.type === "delta" ? source.id : null, source_state_version_id: source.type === "state_version" ? source.id : null, source_clinical_note_id: source.type === "clinical_note" ? source.id : null, source_page_number: source.page ?? null, source_item_index: source.itemIndex ?? null,
  })));
}

export async function drainPreconsultBriefGeneration(limit = 8): Promise<void> {
  const service = createServiceRoleClient();
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await service.rpc("claim_preconsult_brief_generation_work");
    const work = (Array.isArray(data) ? data[0] : data) as RecordRow | null;
    if (error || !work) return;
    try {
      const first = buildBrief(await sourcePacket(service, String(work.consultation_id)));
      const fingerprint = preconsultSourceWatermark({ watermark: first.watermark, selection: PRECONSULT_SELECTION_CONTRACT_VERSION, schema: PRECONSULT_BRIEF_SCHEMA_VERSION, generator: PRECONSULT_GENERATOR_VERSION });
      const second = buildBrief(await sourcePacket(service, String(work.consultation_id)));
      if (second.watermark !== first.watermark) { await service.rpc("fail_preconsult_brief_generation_work", { p_work_id: String(work.id), p_failure_code: "brief_source_changed" }); continue; }
      const resultState = second.brief.whyToday.verbatim || second.brief.changes.length || second.brief.patientOverview.length || second.brief.needsAttention.length || second.brief.alreadyKnown.lastVisit ? "ready" : "partial";
      const { error: finalizeError } = await service.rpc("finalize_preconsult_brief_generation", { p_work_id: String(work.id), p_source_watermark: second.watermark, p_source_manifest: second.sourceManifest, p_selection_contract_version: PRECONSULT_SELECTION_CONTRACT_VERSION, p_brief_schema_version: PRECONSULT_BRIEF_SCHEMA_VERSION, p_generator_version: PRECONSULT_GENERATOR_VERSION, p_model_version: null, p_generation_fingerprint: fingerprint, p_result_state: resultState, p_payload: second.brief, p_evidence_links: evidenceRows(second.brief) });
      if (finalizeError) throw new Error("preconsult_finalize_failed");
    } catch {
      await service.rpc("fail_preconsult_brief_generation_work", { p_work_id: String(work.id), p_failure_code: "brief_generation_failed" });
    }
  }
}

/**
 * Returns the frozen pre-consult artifact captured at consultation start.
 * It never consults the mutable current pointer, lifecycle RPC, or generator.
 */
export async function getPreconsultBriefAtConsultationStart(
  context: PreconsultBriefStartContext,
): Promise<PreconsultBriefAtConsultationStart> {
  try {
    const client = await createServerClient();
    const { data: snapshotData, error: snapshotError } = await client
      .from("preconsult_brief_start_snapshots")
      .select("consultation_id,clinic_id,patient_id,origin_patient_id,brief_version_id,availability")
      .eq("consultation_id", context.consultationId)
      .maybeSingle();
    if (snapshotError || !snapshotData) return { status: "unavailable" };

    const snapshot = snapshotData as PreconsultBriefStartSnapshotRecord;
    if (snapshot.availability === "none_available") {
      return resolvePreconsultBriefAtConsultationStart(context, snapshot, null);
    }

    const briefVersionId = stringValue(snapshot.brief_version_id);
    if (snapshot.availability !== "brief_available" || !briefVersionId) {
      return { status: "unavailable" };
    }

    // Query only the immutable ID stored in this snapshot. In particular, do
    // not fall back to a current or latest version if this read cannot resolve.
    const { data: versionData, error: versionError } = await client
      .from("preconsult_brief_versions")
      .select("id,consultation_id,clinic_id,patient_id,origin_patient_id,payload")
      .eq("id", briefVersionId)
      .maybeSingle();
    if (versionError || !versionData) return { status: "unavailable" };

    return resolvePreconsultBriefAtConsultationStart(
      context,
      snapshot,
      versionData as PreconsultBriefVersionRecord,
    );
  } catch {
    return { status: "unavailable" };
  }
}

export async function getCurrentPreconsultBrief(consultationId: string): Promise<PreconsultArtifact | null> {
  // Retained for callers that only need the artifact; currentness is always
  // the server-owned pointer/snapshot contract, never generated_at ordering.
  return (await getPreconsultBriefSnapshot(consultationId)).artifact;
}

export async function getPreconsultBriefSnapshot(consultationId: string): Promise<{ artifact: PreconsultArtifact | null; lifecycle: PreconsultBriefLifecycle }> {
  const client = await createServerClient();
  const { data, error } = await client.rpc("get_preconsult_brief_snapshot", { p_consultation_id: consultationId });
  if (error) throw new Error("preconsult_snapshot_unavailable");
  const row = (Array.isArray(data) ? data[0] : data) as RecordRow | null;
  const lifecycle = row?.lifecycle;
  if (lifecycle !== "ready" && lifecycle !== "partial" && lifecycle !== "updating" && lifecycle !== "unavailable") throw new Error("preconsult_snapshot_unavailable");
  if (!row?.id) return { artifact: null, lifecycle };
  return { artifact: { id: String(row.id), resultState: row.result_state as "ready" | "partial", sourceWatermark: String(row.source_watermark), generatedAt: String(row.generated_at), payload: preconsultBriefSchema.parse(row.payload) }, lifecycle };
}

export async function getPreconsultBriefLifecycle(consultationId: string): Promise<PreconsultBriefLifecycle> {
  const client = await createServerClient();
  const { data, error } = await client.rpc("get_preconsult_brief_lifecycle", { p_consultation_id: consultationId });
  if (error) throw new Error("preconsult_lifecycle_unavailable");
  const row = (Array.isArray(data) ? data[0] : data) as RecordRow | null;
  const lifecycle = row?.lifecycle;
  if (lifecycle === "ready" || lifecycle === "partial" || lifecycle === "updating" || lifecycle === "unavailable") return lifecycle;
  throw new Error("preconsult_lifecycle_unavailable");
}

export async function getPreconsultTrendGroups(patientId: string, relevantObservationIds: string[]): Promise<PreconsultTrendGroup[]> {
  if (!relevantObservationIds.length) return [];
  const client = await createServerClient();
  const [observationsResult, correctionsResult] = await Promise.all([
    client.from("clinical_observation_trend_inputs").select("id,normalized_key,display_name,normalized_value,source_document_id,source_page_number,effective_date,effective_date_precision").eq("patient_id", patientId).not("effective_date", "is", null),
    client.from("current_clinical_observation_corrections").select("id,source_observation_id,corrected_display_name,corrected_normalized_value,corrected_effective_date,corrected_effective_date_precision").eq("patient_id", patientId),
  ]);
  if (observationsResult.error || correctionsResult.error) throw new Error("preconsult_trends_unavailable");
  const corrections = new Map(((correctionsResult.data ?? []) as RecordRow[]).map((row) => [String(row.source_observation_id), row]));
  const points = ((observationsResult.data ?? []) as RecordRow[]).flatMap((row): PreconsultTrendPoint[] => {
    const correction = corrections.get(String(row.id));
    const original = row.normalized_value as RecordRow;
    const effective = (correction?.corrected_normalized_value ?? original) as RecordRow;
    const numeric = effective.numericValue;
    const unit = stringValue(effective.unit);
    const date = stringValue(correction?.corrected_effective_date ?? row.effective_date);
    if (typeof numeric !== "number" || !Number.isFinite(numeric) || !unit || !date || typeof row.source_document_id !== "string") return [];
    return [{ observationId: String(row.id), displayName: stringValue(correction?.corrected_display_name) ?? String(row.display_name), normalizedKey: String(row.normalized_key), value: numeric, valueText: stringValue(effective.valueText) ?? String(numeric), unit, referenceRange: stringValue(effective.referenceRange), effectiveDate: date, datePrecision: (correction?.corrected_effective_date ? correction.corrected_effective_date_precision : row.effective_date_precision) as PreconsultTrendPoint["datePrecision"], sourceDocumentId: row.source_document_id, sourcePageNumber: typeof row.source_page_number === "number" ? row.source_page_number : null, originalValueText: stringValue(original.valueText) ?? String(numeric), corrected: Boolean(correction), correctionId: correction ? String(correction.id) : null }];
  });
  return buildComparableTrendGroups(points, relevantObservationIds);
}

export async function recordPreconsultBriefView(consultationId: string, briefVersionId: string) {
  const client = await createServerClient();
  return recordPreconsultBriefViewWithClient(client, consultationId, briefVersionId);
}
