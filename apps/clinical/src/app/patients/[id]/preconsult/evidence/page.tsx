import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import styles from "@/components/clinical.module.css";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { getSessionContext } from "@/lib/db/session";
import { deltaEvidenceSources, preconsultEvidenceHref, preconsultEvidenceLabel, preconsultEvidenceSourceTypeSchema, getPreconsultEvidenceSource, type PreconsultEvidenceSource } from "@/lib/preconsult/evidence";

function fieldLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function factualValue(value: unknown): string {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function documentLink(patientId: string, detail: Record<string, unknown>) {
  const documentId = typeof detail.sourceDocumentId === "string" ? detail.sourceDocumentId : typeof detail.documentId === "string" ? detail.documentId : null;
  const page = typeof detail.sourcePageNumber === "number" ? detail.sourcePageNumber : null;
  if (!documentId) return null;
  const source: PreconsultEvidenceSource = { type: "document", id: documentId, page };
  return <p><Link className={styles.panelLink} href={preconsultEvidenceHref(patientId, source)}>View original evidence{page ? ` · page ${page}` : ""}</Link></p>;
}

export default async function PreconsultEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; source?: string }>;
}) {
  const [{ id: patientId }, query] = await Promise.all([params, searchParams]);
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.role !== "doctor") redirect("/desk");
  const sourceType = preconsultEvidenceSourceTypeSchema.safeParse(query.type);
  if (!sourceType.success || !query.source) notFound();

  const [evidenceResult, clinicName, patientResult] = await Promise.all([
    getPreconsultEvidenceSource(patientId, sourceType.data, query.source).catch(() => null),
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { pageSize: 1 }),
  ]);
  if (!evidenceResult) notFound();
  const evidence = evidenceResult;
  const consultationId = typeof evidence.detail.consultationId === "string" ? evidence.detail.consultationId : null;
  const deltaSources = evidence.sourceType === "delta" ? deltaEvidenceSources(evidence.detail) : [];
  const detailEntries = Object.entries(evidence.detail).filter(([key]) => key !== "evidence");

  return <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientResult.total} role="doctor" workspace="clinical"><div className={styles.pageContent}>
    <Link href={`/patients/${patientId}`} className={styles.backLink}>Patient record</Link>
    <header className={styles.profileHeader}><div className={styles.profileHeaderMain}><p className={styles.eyebrow}>Pre-consult source evidence</p><h1>{evidence.title}</h1><p>{evidence.verification.replace(/_/g, " ")}</p></div></header>
    <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Exact cited record</p><h2>Source details</h2></div></div><dl className={styles.infoList}>{detailEntries.map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{factualValue(value)}</dd></div>)}</dl>{deltaSources.length ? <div className={styles.noteReadonly}>{deltaSources.map((source) => <div key={`${source.type}-${source.id}-${source.itemIndex ?? 0}`}><strong>{source.type === "observation" ? "External observation" : "Patient intake statement"}</strong><p><Link className={styles.panelLink} href={preconsultEvidenceHref(patientId, source)}>{preconsultEvidenceLabel(source)}{source.itemIndex != null ? ` · item ${source.itemIndex + 1}` : ""}</Link></p></div>)}</div> : null}{documentLink(patientId, evidence.detail)}{consultationId ? <p><Link className={styles.panelLink} href={`/consultations/${consultationId}`}>Open cited consultation</Link></p> : null}</section>
    <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Provenance</p><h2>Record history</h2></div></div><dl className={styles.infoList}>{Object.entries(evidence.provenance).map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{factualValue(value)}</dd></div>)}</dl></section>
  </div></AppShell>;
}
