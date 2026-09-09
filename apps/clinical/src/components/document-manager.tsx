"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  DoctorDocumentExtraction,
  DocumentListItem,
  MedicalDocumentType,
} from "@/lib/db/documents";
import { clinicDateKey } from "@/lib/clinic-date";
import styles from "./clinical.module.css";

const DOCUMENT_TYPES: Array<{ value: MedicalDocumentType; label: string }> = [
  { value: "lab_report", label: "Lab report" },
  { value: "prescription", label: "Prescription" },
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "imaging_report", label: "Imaging report" },
  { value: "procedure_report", label: "Procedure report" },
  { value: "consultation_note", label: "Consultation note" },
  { value: "other", label: "Other document" },
];

function typeLabel(value: MedicalDocumentType): string {
  return DOCUMENT_TYPES.find((item) => item.value === value)?.label ?? "Medical document";
}

function statusLabel(value: DocumentListItem["status"]): string {
  if (value === "needs_review") return "Needs Review";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

async function fetchDocuments(endpoint: string): Promise<DocumentListItem[]> {
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(await responseMessage(response, "Could not load documents."));
  const body = await response.json() as { documents: DocumentListItem[] };
  return body.documents;
}

export function DocumentManager(props: {
  mode: "staff" | "patient";
  consultationId?: string;
  token?: string;
  canReviewExtraction?: boolean;
}) {
  const endpoint = props.mode === "staff"
    ? `/api/consultations/${props.consultationId}/documents`
    : `/api/intake/${encodeURIComponent(props.token ?? "")}/documents`;
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<MedicalDocumentType>("other");
  const [documentDate, setDocumentDate] = useState("");
  const [dateApproximate, setDateApproximate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<MedicalDocumentType>("other");
  const [editDate, setEditDate] = useState("");
  const [editApproximate, setEditApproximate] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<DoctorDocumentExtraction | null>(null);

  useEffect(() => {
    let active = true;
    void fetchDocuments(endpoint)
      .then((items) => {
        if (active) setDocuments(items);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load documents.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [endpoint]);

  async function processDocument(documentId: string) {
    setError(null);
    setProcessingId(documentId);
    setDocuments((current) => current.map((item) => item.id === documentId
      ? { ...item, status: "processing", latestExtractionStatus: "processing", latestFailureReasonCode: null }
      : item));
    try {
      const response = await fetch(`/api/documents/${documentId}/process`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response, "Could not process the document."));
      const body = await response.json() as { document: DocumentListItem };
      setDocuments((current) => current.map((item) => item.id === documentId ? body.document : item));
      if (props.canReviewExtraction) await openExtraction(documentId);
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "Could not process the document.");
      await fetchDocuments(endpoint).then(setDocuments).catch(() => undefined);
    } finally {
      setProcessingId(null);
    }
  }

  async function openExtraction(documentId: string) {
    if (extractionId === documentId) {
      setExtractionId(null);
      setExtraction(null);
      return;
    }
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/extraction`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response, "Could not load the AI extraction."));
      const body = await response.json() as { extraction: DoctorDocumentExtraction };
      setExtractionId(documentId);
      setExtraction(body.extraction);
    } catch (extractionError) {
      setError(extractionError instanceof Error ? extractionError.message : "Could not load the AI extraction.");
    }
  }

  async function uploadDocument(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const fileInput = event.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
    setError(null);
    setPending(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("documentType", documentType);
    if (documentDate) {
      formData.set("documentDate", documentDate);
      formData.set("documentDatePrecision", dateApproximate ? "approximate" : "exact");
    }
    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      if (!response.ok) throw new Error(await responseMessage(response, "Could not upload the document."));
      const body = await response.json() as { document: DocumentListItem };
      setDocuments((current) => [body.document, ...current]);
      setFile(null);
      setDocumentType("other");
      setDocumentDate("");
      setDateApproximate(false);
      if (fileInput) fileInput.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the document.");
    } finally {
      setPending(false);
    }
  }

  function beginEdit(document: DocumentListItem) {
    setEditingId(document.id);
    setEditType(document.documentType);
    setEditDate(document.documentDate ?? "");
    setEditApproximate(document.documentDatePrecision === "approximate");
  }

  async function saveMetadata(documentId: string) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: editType,
          ...(editDate ? {
            documentDate: editDate,
            documentDatePrecision: editApproximate ? "approximate" : "exact",
          } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Could not update document details."));
      const body = await response.json() as { document: DocumentListItem };
      setDocuments((current) => current.map((item) => item.id === documentId ? body.document : item));
      setEditingId(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update document details.");
    } finally {
      setPending(false);
    }
  }

  const today = clinicDateKey();

  return (
    <section className={styles.documentManager} aria-label="Medical documents">
      <div className={styles.documentManagerHeader}>
        <div>
          <strong>Medical documents</strong>
          <span>PDFs and photos are kept as private original evidence.</span>
        </div>
        <span className={styles.documentCount}>{documents.length}</span>
      </div>

      <form className={styles.documentUploadForm} onSubmit={uploadDocument}>
        <label className={styles.intakeField}>
          <span>Choose PDF or photo</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
          <small>Maximum 4 MB. On mobile, you can use the camera or photo library.</small>
        </label>
        <div className={styles.documentMetadataGrid}>
          <label className={styles.intakeField}>
            <span>Document type</span>
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as MedicalDocumentType)}>
              {DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.intakeField}>
            <span>Document date <small>optional</small></span>
            <input type="date" max={today} value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} />
          </label>
        </div>
        {documentDate ? (
          <label className={styles.documentApproximate}>
            <input type="checkbox" checked={dateApproximate} onChange={(event) => setDateApproximate(event.target.checked)} />
            This date is approximate
          </label>
        ) : null}
        <button className={styles.secondaryButton} type="submit" disabled={pending || !file}>
          {pending ? "Uploading securely…" : "Upload document"}
        </button>
      </form>

      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {loading ? <p className={styles.documentEmpty}>Loading documents…</p> : null}
      {!loading && documents.length === 0 ? (
        <p className={styles.documentEmpty}>No documents uploaded for this encounter.</p>
      ) : null}
      {documents.length > 0 ? (
        <ul className={styles.documentList}>
          {documents.map((document) => (
            <li key={document.id} className={styles.documentRow}>
              <div className={styles.documentRowMain}>
                <strong>{document.originalFilename}</strong>
                <span>
                  {typeLabel(document.documentType)} · {statusLabel(document.status)}
                  {document.documentDate
                    ? ` · ${document.documentDate}${document.documentDatePrecision === "approximate" ? " (approx.)" : ""}`
                    : " · date not supplied"}
                </span>
                {document.duplicateOfDocumentId ? (
                  <small className={styles.documentDuplicate}>Possible duplicate of an earlier upload</small>
                ) : null}
                {document.latestExtractionStatus === "technical_failure" ? (
                  <small className={styles.documentProcessingError}>Processing could not finish. The original is safe; retry when ready.</small>
                ) : null}
              </div>
              <div className={styles.documentRowActions}>
                <a
                  className={styles.secondaryButton}
                  href={props.mode === "staff"
                    ? `/api/documents/${document.id}/view`
                    : `/api/intake/${encodeURIComponent(props.token ?? "")}/documents/${document.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View original
                </a>
                {props.mode === "staff" ? (
                  <>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={processingId !== null || document.status === "processing"}
                      onClick={() => void processDocument(document.id)}
                    >
                      {processingId === document.id
                        ? "Processing…"
                        : document.status === "uploaded"
                          ? document.latestExtractionStatus === "technical_failure" ? "Retry processing" : "Process"
                          : "Reprocess"}
                    </button>
                    {props.canReviewExtraction && ["processed", "needs_review"].includes(document.status) ? (
                      <button className={styles.textButton} type="button" onClick={() => void openExtraction(document.id)}>
                        {extractionId === document.id ? "Close extraction" : "Review extraction"}
                      </button>
                    ) : null}
                    <button className={styles.textButton} type="button" onClick={() => beginEdit(document)}>
                      Edit details
                    </button>
                  </>
                ) : null}
              </div>
              {props.mode === "staff" && editingId === document.id ? (
                <div className={styles.documentEditForm}>
                  <select value={editType} onChange={(event) => setEditType(event.target.value as MedicalDocumentType)}>
                    {DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <input type="date" max={today} value={editDate} onChange={(event) => setEditDate(event.target.value)} />
                  {editDate ? (
                    <label><input type="checkbox" checked={editApproximate} onChange={(event) => setEditApproximate(event.target.checked)} /> Approximate</label>
                  ) : null}
                  <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => void saveMetadata(document.id)}>Save</button>
                  <button className={styles.textButton} type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : null}
              {props.canReviewExtraction && extractionId === document.id && extraction ? (
                <DocumentExtractionReview extraction={extraction} documentId={document.id} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function confidenceLabel(value: number | null): string {
  if (value === null) return "Not available";
  return `${Math.round(value * 100)}%`;
}

function observationValue(observation: DoctorDocumentExtraction["observations"][number]): string {
  const value = observation.normalizedValue;
  return [value.valueText, value.unit, value.referenceRange ? `reference ${value.referenceRange}` : ""]
    .filter(Boolean)
    .join(" · ") || "Mentioned without a structured value";
}

function observationDate(observation: DoctorDocumentExtraction["observations"][number]): string {
  if (!observation.effectiveDateText) return "Date not available";
  return `${observation.effectiveDateText}${observation.effectiveDatePrecision === "approximate" ? " (approx.)" : ""}`;
}

function DocumentExtractionReview({
  extraction,
  documentId,
}: {
  extraction: DoctorDocumentExtraction;
  documentId: string;
}) {
  const payload = extraction.rawExtractionJson as {
    readabilityConfidence?: number;
    isHandwritten?: boolean;
    isPartiallyUnreadable?: boolean;
    documentDate?: string;
    pages?: Array<{ pageNumber: number; text: string; confidence: number }>;
    uncertainItems?: Array<{ text: string; reason: string; pageNumber: number; confidence: number }>;
  } | null;
  const pages = Array.isArray(payload?.pages) ? payload.pages : [];
  const uncertainItems = Array.isArray(payload?.uncertainItems) ? payload.uncertainItems : [];

  return (
    <section className={styles.documentExtractionReview} aria-label="AI document extraction">
      <div className={styles.documentExtractionNotice}>
        AI-derived draft. Doctor verification against the original is required. It does not diagnose, prescribe, or update confirmed clinical records.
      </div>
      <div className={styles.documentExtractionMeta}>
        <span><strong>Classification</strong>{extraction.classificationType ? typeLabel(extraction.classificationType) : "Unknown"}</span>
        <span><strong>Classification confidence</strong>{confidenceLabel(extraction.classificationConfidence)}</span>
        <span><strong>Overall confidence</strong>{confidenceLabel(extraction.overallConfidence)}</span>
        <span><strong>Readability</strong>{confidenceLabel(typeof payload?.readabilityConfidence === "number" ? payload.readabilityConfidence : null)}</span>
        <span><strong>Document date</strong>{payload?.documentDate || "Not reliably extracted"}</span>
        <span><strong>Attempt</strong>{extraction.attemptNumber} · {extraction.schemaVersion}</span>
      </div>
      {extraction.needsReviewReasons.length > 0 ? (
        <div className={styles.documentReviewReasons}>
          <strong>Needs Review because</strong>
          <span>{extraction.needsReviewReasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}</span>
        </div>
      ) : null}
      {payload?.isHandwritten || payload?.isPartiallyUnreadable ? (
        <div className={styles.documentReviewReasons}>Handwriting or partially unreadable content was detected. Do not rely on extracted text without checking the original.</div>
      ) : null}
      <div className={styles.documentExtractionSection}>
        <strong>Unconfirmed structured observations</strong>
        {extraction.observations.length > 0 ? (
          <ul>{extraction.observations.map((observation) => (
            <li key={observation.id}>
              <strong>{observation.displayName}</strong> — {observationValue(observation)}
              <br />
              <small>
                {observation.observationType} · {observationDate(observation)} · page {observation.sourcePageNumber} · {confidenceLabel(observation.confidence)} confidence
                {observation.trendEligible ? " · eligible for duplicate-safe trend input" : " · excluded from trend input"}
              </small>
              <blockquote>“{observation.sourceEvidenceText}”</blockquote>
              <a
                className={styles.textButton}
                href={`/api/documents/${documentId}/view#page=${observation.sourcePageNumber}`}
                target="_blank"
                rel="noreferrer"
              >
                View original evidence · page {observation.sourcePageNumber}
              </a>
            </li>
          ))}</ul>
        ) : <p>No reliable labs, medicines, conditions, allergies, or vitals were normalized from this attempt.</p>}
      </div>
      {uncertainItems.length > 0 ? (
        <div className={styles.documentExtractionSection}>
          <strong>Uncertain items</strong>
          <ul>{uncertainItems.map((item, index) => (
            <li key={`${item.pageNumber}-${index}`}>
              {item.text} — {item.reason}{item.pageNumber > 0 ? ` (page ${item.pageNumber})` : ""}
            </li>
          ))}</ul>
        </div>
      ) : null}
      <div className={styles.documentExtractionSection}>
        <strong>Page transcription</strong>
        {pages.length > 0 ? pages.map((page) => (
          <details key={page.pageNumber} open={pages.length === 1}>
            <summary>Page {page.pageNumber} · {confidenceLabel(page.confidence)}</summary>
            <pre>{page.text || "No reliable text extracted."}</pre>
          </details>
        )) : <p>No reliable text was extracted. Open the original.</p>}
      </div>
    </section>
  );
}
