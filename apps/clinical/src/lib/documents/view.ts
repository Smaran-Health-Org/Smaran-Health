export type AuthorizedDocumentSource = {
  storagePath: string;
};

export type DocumentViewWorkflowDependencies = {
  createSignedUrl: (storagePath: string) => Promise<string>;
  recordView: () => Promise<void>;
};

/**
 * Issues a signed original-source URL only after authorization has completed,
 * then records its issuance. Failures intentionally propagate to the route's
 * existing safe error response; an unsuccessful signing never records a view.
 */
export async function issueAuthorizedDocumentViewUrl(
  document: AuthorizedDocumentSource,
  dependencies: DocumentViewWorkflowDependencies
): Promise<string> {
  const signedUrl = await dependencies.createSignedUrl(document.storagePath);
  await dependencies.recordView();
  return signedUrl;
}
