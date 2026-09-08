import Link from "next/link";
import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StartQueuedConsultation } from "@/components/start-queued-consultation";
import { PreconsultTrends } from "@/components/preconsult-trends";
import styles from "@/components/clinical.module.css";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { drainPreconsultBriefGeneration, getPreconsultBriefSnapshot, getPreconsultTrendGroups, recordPreconsultBriefView, type PreconsultBrief } from "@/lib/preconsult/brief";
import { preconsultEvidenceHref, preconsultEvidenceLabel } from "@/lib/preconsult/evidence";
import { getPendingClinicalStateDeltas } from "@/lib/db/clinical-state";
import { whyTodayProvenanceLabel } from "@/lib/preconsult/verification-label";

function verificationLabel(value: string) {
  return value === "confirmed" ? "Doctor-confirmed" : value === "proposed" ? "Proposed — review required" : value === "patient_reported_unconfirmed" ? "Patient-reported — unconfirmed" : value === "external_unconfirmed" ? "External evidence — unconfirmed" : "Needs Review";
}

function Claims({ patientId, claims }: { patientId: string; claims: Array<{ id: string; text: string; verification: string; sources: PreconsultBrief["evidenceSummary"] }> }) {
  if (!claims.length) return <p className={styles.memorySummary}>No supported information is available in this section.</p>;
  return <div className={styles.noteReadonly}>{claims.map((claim) => <div key={claim.id}><strong>{verificationLabel(claim.verification)}</strong><p>{claim.text}</p><p>{claim.sources.map((source) => <Link key={`${source.type}-${source.id}`} href={preconsultEvidenceHref(patientId, source)} className={styles.panelLink}>{preconsultEvidenceLabel(source)}</Link>)}</p></div>)}</div>;
}

export default async function PreconsultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ consultation?: string }> }) {
  const [{ id: patientId }, { consultation: consultationId }] = await Promise.all([params, searchParams]);
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.role !== "doctor") redirect("/desk");
  if (!consultationId) notFound();
  const client = await createServerClient();
  const [{ data: consultation }, { data: appointment }, clinicName, patientResult] = await Promise.all([
    client.from("consultations").select("id,patient_id,clinic_id,started_at,is_priority,priority_reason,priority_updated_at").eq("id", consultationId).eq("patient_id", patientId).eq("clinic_id", session.clinicId).maybeSingle(),
    client.from("appointments").select("id").eq("consultation_id", consultationId).eq("clinic_id", session.clinicId).maybeSingle(),
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { pageSize: 1 }),
  ]);
  if (!consultation || !appointment) notFound();
  const { data: patient } = await client.from("patients").select("full_name,age,gender").eq("id", patientId).eq("clinic_id", session.clinicId).maybeSingle();
  if (!patient) notFound();
  const [snapshotResult, fallbackSources, pendingDeltas] = await Promise.all([
    getPreconsultBriefSnapshot(consultationId).catch(() => ({ artifact: null, lifecycle: "unavailable" as const })),
    Promise.all([
      client.from("patient_intake_statements").select("reason_for_visit_raw,information_source").eq("consultation_id", consultationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      client.from("documents").select("id,original_filename,document_type").eq("patient_id", patientId).eq("clinic_id", session.clinicId).order("created_at", { ascending: false }).limit(6),
    ]),
    getPendingClinicalStateDeltas(patientId).catch(() => []),
  ]);
  const { artifact: brief, lifecycle } = snapshotResult;
  if (brief) await recordPreconsultBriefView(consultationId, brief.id).catch(() => undefined);
  after(() => drainPreconsultBriefGeneration().catch(() => undefined));
  const payload = brief?.payload;
  const relevantObservationIds = payload ? [...payload.changes, ...payload.patientOverview].flatMap((claim) => claim.sources.filter((source) => source.type === "observation").map((source) => source.id)) : [];
  const trends = relevantObservationIds.length ? await getPreconsultTrendGroups(patientId, relevantObservationIds).catch(() => []) : [];
  const [fallbackIntake, fallbackDocuments] = fallbackSources;
  const meta = [patient.age != null ? `${patient.age} years` : null, patient.gender].filter(Boolean).join(" · ");
  return <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientResult.total} role="doctor" workspace="clinical"><div className={styles.pageContent}>
    <Link href="/dashboard" className={styles.backLink}>Today&apos;s overview</Link>
    <header className={styles.profileHeader}><span className={styles.profileAvatar}>{patient.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase()}</span><div className={styles.profileHeaderMain}><p className={styles.eyebrow}>Pre-consult brief · preparation aid</p><h1>{patient.full_name}</h1><p>{meta || "Patient record"}</p>{consultation.is_priority ? <p className={styles.panelHint}>Human Priority context{consultation.priority_updated_at ? ` · set ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(consultation.priority_updated_at))}` : ""}{consultation.priority_reason ? ` · ${consultation.priority_reason}` : ""}</p> : null}</div></header>
    {!payload ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Preparing</p><h2>Brief unavailable for the moment</h2></div></div><p className={styles.memorySummary}>Original intake and evidence remain available. This does not delay care.</p></section> : <>
      {lifecycle === "updating" ? <div className={styles.errorBanner} role="status"><strong>Updating — newer information available.</strong> This brief was generated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(brief.generatedAt))}; it remains available while the newer information is prepared.</div> : null}
      {lifecycle === "partial" ? <div className={styles.errorBanner} role="status">Partial brief: some eligible source categories are not available yet. Original evidence remains available.</div> : null}
      <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Patient statement</p><h2>Why today?</h2></div></div><div className={styles.memoryCard}><strong>{whyTodayProvenanceLabel(payload.whyToday.provenance)}</strong><p className={styles.memorySummary}>{payload.whyToday.verbatim ?? "No reason for visit has been submitted."}</p></div></section>
      {payload.mode === "returning" ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Since last approved visit</p><h2>What changed since last visit?</h2></div></div><Claims patientId={patientId} claims={payload.changes} /></section> : <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>No prior approved consultation</p><h2>Patient overview</h2></div></div><Claims patientId={patientId} claims={payload.patientOverview} /></section>}
      <PreconsultTrends trends={trends} />
      {payload.needsAttention.length ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Review obligations</p><h2>What needs my attention?</h2></div></div><Claims patientId={patientId} claims={payload.needsAttention} />{pendingDeltas.length ? <Link className={styles.secondaryButton} href={`/patients/${patientId}/preconsult/review-changes?consultation=${consultationId}`}>Review {pendingDeltas.length} unresolved {pendingDeltas.length === 1 ? "change" : "changes"}</Link> : null}</section> : null}
      {payload.alreadyKnown.lastVisit || payload.alreadyKnown.approvedMemory.length ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Prior approved record</p><h2>What do I already know?</h2></div></div>{payload.alreadyKnown.lastVisit ? <div className={styles.memoryCard}><strong>Last approved visit</strong><p className={styles.memorySummary}>{payload.alreadyKnown.lastVisit.summary ?? "No summary was recorded."}</p></div> : null}<Claims patientId={patientId} claims={payload.alreadyKnown.approvedMemory} /></section> : null}
    </>}
    {pendingDeltas.length && !payload?.needsAttention.length ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Review obligations</p><h2>Proposed clinical changes</h2></div></div><p className={styles.memorySummary}>These changes remain unconfirmed until an authorized doctor reviews them.</p><Link className={styles.secondaryButton} href={`/patients/${patientId}/preconsult/review-changes?consultation=${consultationId}`}>Review {pendingDeltas.length} unresolved {pendingDeltas.length === 1 ? "change" : "changes"}</Link></section> : null}
    {lifecycle === "partial" || lifecycle === "unavailable" ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Original authorized sources</p><h2>Available evidence</h2></div></div>{fallbackIntake.data?.reason_for_visit_raw ? <div className={styles.memoryCard}><strong>{fallbackIntake.data.information_source === "patient" ? "Patient statement" : "Assisted patient statement"}</strong><p className={styles.memorySummary}>{fallbackIntake.data.reason_for_visit_raw}</p></div> : <p className={styles.memorySummary}>No intake statement is available.</p>}<div className={styles.noteReadonly}>{(fallbackDocuments.data ?? []).map((document) => <div key={document.id}><strong>{document.document_type}</strong><p><Link className={styles.panelLink} href={`/api/documents/${document.id}/view`}>View original {document.original_filename}</Link></p></div>)}</div><Link href={`/patients/${patientId}`} className={styles.secondaryButton}>Open patient record</Link></section> : null}
    <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Care is never blocked</p><h2>Ready when you are</h2></div></div><StartQueuedConsultation appointmentId={appointment.id} consultationId={consultationId} /></section>
  </div></AppShell>;
}
