import { createClient as createServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export type MedicalDocumentType =
  | "lab_report"
  | "prescription"
  | "discharge_summary"
  | "imaging_report"
  | "procedure_report"
  | "consultation_note"
  | "other";
export type DocumentDatePrecision = "unknown" | "exact" | "approximate";
export type DocumentStatus = "uploaded" | "processing" | "processed" | "needs_review";
export type DocumentExtractionStatus = "processing" | "succeeded" | "needs_review" | "technical_failure";
export type DocumentProcessingFailureCode =
  | "provider_unavailable"
  | "provider_timeout"
  | "invalid_response"
  | "source_unavailable"
  | "unsupported_source"
  | "processing_interrupted";

export type DocumentUploadContext = {
  clinicId: string;
  patientId: string;
  originPatientId: string;
  consultationId: string;
  patientIntakeId: string | null;
};

export type DocumentListItem = {
  id: string;
  originalFilename: string;
  documentType: MedicalDocumentType;
  documentDate: string | null;
  documentDateSource: "unknown" | "user_entered" | "extracted";
  documentDatePrecision: DocumentDatePrecision;
  status: DocumentStatus;
  duplicateOfDocumentId: string | null;
  createdAt: string;
  latestExtractionStatus: DocumentExtractionStatus | null;
  latestFailureReasonCode: DocumentProcessingFailureCode | null;
};

export type DocumentProcessingClaim = {
  extractionId: string;
  documentId: string;
  storagePath: string;
  mimeType: string;
  attemptNumber: number;
};

export type DoctorDocumentExtraction = {
  id: string;
  attemptNumber: number;
  schemaVersion: string;
  pipelineVersion: string;
  provider: string;
  modelVersion: string;
  status: DocumentExtractionStatus;
  rawExtractionJson: Record<string, unknown> | null;
  classificationType: MedicalDocumentType | null;
  classificationConfidence: number | null;
  overallConfidence: number | null;
  needsReviewReasons: string[];
  failureReasonCode: DocumentProcessingFailureCode | null;
  startedAt: string;
  completedAt: string | null;
  observations: DoctorClinicalObservation[];
};

export type DoctorClinicalObservation = {
  id: string;
  observationType: "lab" | "medication" | "condition" | "allergy" | "vital";
  normalizedKey: string;
  displayName: string;
  normalizedValue: {
    valueText: string;
    numericValue: number | null;
    unit: string | null;
    referenceRange: string | null;
    qualifier: string | null;
  };
  sourcePageNumber: number;
  sourceEvidenceText: string;
  confidence: number;
  verificationState: "unconfirmed";
  effectiveDate: string | null;
  effectiveDateText: string | null;
  effectiveDatePrecision: DocumentDatePrecision;
  effectiveDateSource: "unknown" | "observation_extracted" | "document_extracted" | "user_entered";
  trendEligible: boolean;
};

export type RegisterDocumentInput = {
  documentId: string;
  storagePath: string;
  contentHash: string;
  mimeType: string;
  fileSize: number;
  originalFilename: string;
  documentType: MedicalDocumentType;
  documentDate?: string;
  documentDatePrecision: DocumentDatePrecision;
};

export type AuthorizedDocumentView = {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
};

export class DocumentAccessError extends Error {
  constructor(public readonly kind: "forbidden" | "consent_required" | "busy" | "not_found" | "invalid" | "unavailable") {
    super("Medical document operation failed");
    this.name = "DocumentAccessError";
  }
}

function mapRpcError(error: { code?: string; message?: string }): never {
  if (error.code === "42501" && error.message?.includes("processing consent")) {
    throw new DocumentAccessError("consent_required");
  }
  if (error.code === "42501") throw new DocumentAccessError("forbidden");
  if (error.code === "55P03") throw new DocumentAccessError("busy");
  if (error.code === "P0002") throw new DocumentAccessError("not_found");
  if (["22023", "23505", "23514"].includes(error.code ?? "")) {
    throw new DocumentAccessError("invalid");
  }
  throw new DocumentAccessError("unavailable");
}

function uploadContext(row: Record<string, unknown> | undefined): DocumentUploadContext | null {
  if (!row) return null;
  return {
    clinicId: String(row.clinic_id),
    patientId: String(row.patient_id),
    originPatientId: String(row.origin_patient_id),
    consultationId: String(row.consultation_id),
    patientIntakeId: typeof row.patient_intake_id === "string" ? row.patient_intake_id : null,
  };
}

export function documentItemFromRow(row: Record<string, unknown>): DocumentListItem {
  return {
    id: String(row.id),
    originalFilename: String(row.original_filename),
    documentType: row.document_type as MedicalDocumentType,
    documentDate: typeof row.document_date === "string" ? row.document_date : null,
    documentDateSource: row.document_date_source as DocumentListItem["documentDateSource"],
    documentDatePrecision: row.document_date_precision as DocumentDatePrecision,
    status: row.status as DocumentStatus,
    duplicateOfDocumentId: typeof row.duplicate_of_document_id === "string"
      ? row.duplicate_of_document_id
      : null,
    createdAt: String(row.created_at),
    latestExtractionStatus: typeof row.latest_extraction_status === "string"
      ? row.latest_extraction_status as DocumentExtractionStatus
      : null,
    latestFailureReasonCode: typeof row.latest_failure_reason_code === "string"
      ? row.latest_failure_reason_code as DocumentProcessingFailureCode
      : null,
  };
}

export async function getStaffDocumentUploadContextWithClient(
  supabase: ServerClient,
  consultationId: string
): Promise<DocumentUploadContext | null> {
  const { data, error } = await supabase.rpc("get_staff_document_upload_context", {
    p_consultation_id: consultationId,
  });
  if (error) mapRpcError(error);
  return uploadContext((data as Array<Record<string, unknown>> | null)?.[0]);
}

export async function getStaffDocumentUploadContext(consultationId: string) {
  const supabase = await createServerClient();
  return getStaffDocumentUploadContextWithClient(supabase, consultationId);
}

export async function getPatientDocumentUploadContextWithClient(
  supabase: ServerClient,
  tokenHash: string,
  verifiedSessionHash: string
): Promise<DocumentUploadContext | null> {
  const { data, error } = await supabase.rpc("get_patient_document_upload_context", {
    p_token_hash: tokenHash,
    p_verified_session_hash: verifiedSessionHash,
  });
  if (error) mapRpcError(error);
  return uploadContext((data as Array<Record<string, unknown>> | null)?.[0]);
}

export async function getPatientDocumentUploadContext(tokenHash: string, verifiedSessionHash: string) {
  const supabase = await createServerClient();
  return getPatientDocumentUploadContextWithClient(supabase, tokenHash, verifiedSessionHash);
}

function registrationArgs(input: RegisterDocumentInput) {
  return {
    p_id: input.documentId,
    p_storage_path: input.storagePath,
    p_content_hash: input.contentHash,
    p_mime_type: input.mimeType,
    p_file_size: input.fileSize,
    p_original_filename: input.originalFilename,
    p_document_type: input.documentType,
    p_document_date: input.documentDate ?? null,
    p_document_date_precision: input.documentDatePrecision,
  };
}

export async function registerStaffDocumentWithClient(
  supabase: ServerClient,
  consultationId: string,
  input: RegisterDocumentInput
): Promise<DocumentListItem> {
  const { data, error } = await supabase.rpc("register_staff_document", {
    p_consultation_id: consultationId,
    ...registrationArgs(input),
  });
  if (error) mapRpcError(error);
  if (!data) throw new DocumentAccessError("unavailable");
  return documentItemFromRow(data as Record<string, unknown>);
}

export async function registerStaffDocument(consultationId: string, input: RegisterDocumentInput) {
  const supabase = await createServerClient();
  return registerStaffDocumentWithClient(supabase, consultationId, input);
}

export async function registerPatientDocumentWithClient(
  supabase: ServerClient,
  tokenHash: string,
  verifiedSessionHash: string,
  input: RegisterDocumentInput
): Promise<DocumentListItem> {
  const { data, error } = await supabase.rpc("register_patient_document", {
    p_token_hash: tokenHash,
    p_verified_session_hash: verifiedSessionHash,
    ...registrationArgs(input),
  });
  if (error) mapRpcError(error);
  if (!data) throw new DocumentAccessError("unavailable");
  return documentItemFromRow(data as Record<string, unknown>);
}

export async function registerPatientDocument(
  tokenHash: string,
  verifiedSessionHash: string,
  input: RegisterDocumentInput
) {
  const supabase = await createServerClient();
  return registerPatientDocumentWithClient(supabase, tokenHash, verifiedSessionHash, input);
}

export async function listStaffDocuments(consultationId: string): Promise<DocumentListItem[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("get_staff_documents", {
    p_consultation_id: consultationId,
  });
  if (error) mapRpcError(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map(documentItemFromRow);
}

export async function beginDocumentProcessingWithClient(
  supabase: ServerClient,
  input: {
    documentId: string;
    schemaVersion: string;
    pipelineVersion: string;
    provider: string;
    modelVersion: string;
  }
): Promise<DocumentProcessingClaim> {
  const { data, error } = await supabase.rpc("begin_document_processing", {
    p_document_id: input.documentId,
    p_schema_version: input.schemaVersion,
    p_pipeline_version: input.pipelineVersion,
    p_provider: input.provider,
    p_model_version: input.modelVersion,
  });
  if (error) mapRpcError(error);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) throw new DocumentAccessError("not_found");
  return {
    extractionId: String(row.extraction_id),
    documentId: String(row.document_id),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    attemptNumber: Number(row.attempt_number),
  };
}

export async function beginDocumentProcessing(
  input: Parameters<typeof beginDocumentProcessingWithClient>[1]
) {
  const supabase = await createServerClient();
  return beginDocumentProcessingWithClient(supabase, input);
}

export async function getDoctorLatestDocumentExtraction(
  documentId: string
): Promise<DoctorDocumentExtraction | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("document_extractions")
    .select("id, attempt_number, schema_version, pipeline_version, provider, model_version, status, raw_extraction_json, classification_type, classification_confidence, overall_confidence, needs_review_reasons, failure_reason_code, started_at, completed_at")
    .eq("document_id", documentId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DocumentAccessError("unavailable");
  if (!data) return null;
  const { data: observationRows, error: observationError } = await supabase
    .from("clinical_observations")
    .select("id, observation_type, normalized_key, display_name, normalized_value, source_page_number, source_evidence_text, confidence, verification_state, effective_date, effective_date_text, effective_date_precision, effective_date_source")
    .eq("source_extraction_id", data.id)
    .order("source_item_index", { ascending: true });
  if (observationError) throw new DocumentAccessError("unavailable");
  const observationIds = (observationRows ?? []).map((row) => row.id);
  const trendEligibleIds = new Set<string>();
  if (observationIds.length > 0) {
    const { data: trendRows, error: trendError } = await supabase
      .from("clinical_observation_trend_inputs")
      .select("id")
      .in("id", observationIds);
    if (trendError) throw new DocumentAccessError("unavailable");
    for (const row of trendRows ?? []) trendEligibleIds.add(row.id);
  }
  return {
    id: data.id,
    attemptNumber: data.attempt_number,
    schemaVersion: data.schema_version,
    pipelineVersion: data.pipeline_version,
    provider: data.provider,
    modelVersion: data.model_version,
    status: data.status as DocumentExtractionStatus,
    rawExtractionJson: data.raw_extraction_json as Record<string, unknown> | null,
    classificationType: data.classification_type as MedicalDocumentType | null,
    classificationConfidence: data.classification_confidence,
    overallConfidence: data.overall_confidence,
    needsReviewReasons: data.needs_review_reasons ?? [],
    failureReasonCode: data.failure_reason_code as DocumentProcessingFailureCode | null,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    observations: (observationRows ?? []).map((row) => ({
      id: row.id,
      observationType: row.observation_type as DoctorClinicalObservation["observationType"],
      normalizedKey: row.normalized_key,
      displayName: row.display_name,
      normalizedValue: row.normalized_value as DoctorClinicalObservation["normalizedValue"],
      sourcePageNumber: row.source_page_number,
      sourceEvidenceText: row.source_evidence_text,
      confidence: row.confidence,
      verificationState: row.verification_state as "unconfirmed",
      effectiveDate: row.effective_date,
      effectiveDateText: row.effective_date_text,
      effectiveDatePrecision: row.effective_date_precision as DocumentDatePrecision,
      effectiveDateSource: row.effective_date_source as DoctorClinicalObservation["effectiveDateSource"],
      trendEligible: trendEligibleIds.has(row.id),
    })),
  };
}

export async function listPatientDocumentsWithClient(
  supabase: ServerClient,
  tokenHash: string,
  verifiedSessionHash: string
): Promise<DocumentListItem[]> {
  const { data, error } = await supabase.rpc("get_patient_intake_documents", {
    p_token_hash: tokenHash,
    p_verified_session_hash: verifiedSessionHash,
  });
  if (error) mapRpcError(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map(documentItemFromRow);
}

export async function listPatientDocuments(tokenHash: string, verifiedSessionHash: string) {
  const supabase = await createServerClient();
  return listPatientDocumentsWithClient(supabase, tokenHash, verifiedSessionHash);
}

function authorizedView(row: Record<string, unknown> | undefined): AuthorizedDocumentView | null {
  if (!row) return null;
  return {
    storagePath: String(row.storage_path),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
  };
}

export async function authorizeStaffDocumentView(documentId: string): Promise<AuthorizedDocumentView | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("authorize_staff_document_view", {
    p_document_id: documentId,
  });
  if (error) mapRpcError(error);
  return authorizedView((data as Array<Record<string, unknown>> | null)?.[0]);
}

export async function authorizePatientDocumentView(
  tokenHash: string,
  verifiedSessionHash: string,
  documentId: string
): Promise<AuthorizedDocumentView | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("authorize_patient_document_view", {
    p_token_hash: tokenHash,
    p_verified_session_hash: verifiedSessionHash,
    p_document_id: documentId,
  });
  if (error) mapRpcError(error);
  return authorizedView((data as Array<Record<string, unknown>> | null)?.[0]);
}

export async function recordStaffDocumentViewWithClient(
  supabase: ServerClient,
  documentId: string
): Promise<void> {
  const { error } = await supabase.rpc("record_staff_document_view", {
    p_document_id: documentId,
  });
  if (error) mapRpcError(error);
}

export async function recordStaffDocumentView(documentId: string): Promise<void> {
  const supabase = await createServerClient();
  await recordStaffDocumentViewWithClient(supabase, documentId);
}

export async function recordPatientDocumentViewWithClient(
  supabase: ServerClient,
  tokenHash: string,
  verifiedSessionHash: string,
  documentId: string
): Promise<void> {
  const { error } = await supabase.rpc("record_patient_document_view", {
    p_token_hash: tokenHash,
    p_verified_session_hash: verifiedSessionHash,
    p_document_id: documentId,
  });
  if (error) mapRpcError(error);
}

export async function recordPatientDocumentView(
  tokenHash: string,
  verifiedSessionHash: string,
  documentId: string
): Promise<void> {
  const supabase = await createServerClient();
  await recordPatientDocumentViewWithClient(
    supabase,
    tokenHash,
    verifiedSessionHash,
    documentId
  );
}

export async function updateDocumentMetadataWithClient(
  supabase: ServerClient,
  input: {
    documentId: string;
    documentType: MedicalDocumentType;
    documentDate?: string;
    documentDatePrecision: DocumentDatePrecision;
  }
): Promise<DocumentListItem> {
  const { data, error } = await supabase.rpc("update_document_metadata", {
    p_document_id: input.documentId,
    p_document_type: input.documentType,
    p_document_date: input.documentDate ?? null,
    p_document_date_precision: input.documentDatePrecision,
  });
  if (error) mapRpcError(error);
  if (!data) throw new DocumentAccessError("unavailable");
  return documentItemFromRow(data as Record<string, unknown>);
}

export async function updateDocumentMetadata(
  input: Parameters<typeof updateDocumentMetadataWithClient>[1]
) {
  const supabase = await createServerClient();
  return updateDocumentMetadataWithClient(supabase, input);
}
