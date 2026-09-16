import type { DocumentListItem, RegisterDocumentInput } from "@/lib/db/documents";
import type { SupportedDocumentMime } from "./file";

export class DocumentOriginalAlreadyExistsError extends Error {
  constructor() {
    super("Private document original already exists");
    this.name = "DocumentOriginalAlreadyExistsError";
  }
}

export type DocumentRegistrationWorkflowDependencies = {
  registration: RegisterDocumentInput;
  bytes: Uint8Array;
  store: (input: { storagePath: string; bytes: Uint8Array; mimeType: SupportedDocumentMime }) => Promise<void>;
  register: (input: RegisterDocumentInput) => Promise<DocumentListItem>;
  lookupRegistered: (input: RegisterDocumentInput) => Promise<DocumentListItem | null>;
  verifyExisting: (input: { storagePath: string; contentHash: string }) => Promise<boolean>;
};

export type DocumentRegistrationWorkflowResult =
  | { kind: "registered"; document: DocumentListItem }
  | { kind: "storage_failure" }
  | { kind: "registration_failure" };

/**
 * Reconciles a stable storage path without ever replacing or deleting source
 * evidence. A failed or ambiguous registration intentionally retains a
 * possible orphan: a later registration may have committed after this request
 * observed no row.
 */
export async function completeDocumentRegistration(
  input: DocumentRegistrationWorkflowDependencies
): Promise<DocumentRegistrationWorkflowResult> {
  let existingObject = false;
  try {
    await input.store({ storagePath: input.registration.storagePath, bytes: input.bytes, mimeType: input.registration.mimeType as SupportedDocumentMime });
  } catch (error) {
    if (error instanceof DocumentOriginalAlreadyExistsError) existingObject = true;
    else return { kind: "storage_failure" };
  }

  if (existingObject) {
    try {
      const registered = await input.lookupRegistered(input.registration);
      if (registered) return { kind: "registered", document: registered };
      if (!await input.verifyExisting({ storagePath: input.registration.storagePath, contentHash: input.registration.contentHash })) {
        return { kind: "registration_failure" };
      }
    } catch {
      return { kind: "registration_failure" };
    }
  }

  try {
    return { kind: "registered", document: await input.register(input.registration) };
  } catch {
    try {
      const registered = await input.lookupRegistered(input.registration);
      if (registered) return { kind: "registered", document: registered };
    } catch {
      return { kind: "registration_failure" };
    }
    return { kind: "registration_failure" };
  }
}
