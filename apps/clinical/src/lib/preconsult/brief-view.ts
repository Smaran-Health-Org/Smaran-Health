export type PreconsultBriefViewClient = {
  rpc(
    name: "record_preconsult_brief_view",
    args: { p_consultation_id: string; p_brief_version_id: string }
  ): PromiseLike<{ error: unknown }>;
};

/** Records best-effort view provenance through the caller's authenticated RLS client. */
export async function recordPreconsultBriefViewWithClient(
  client: PreconsultBriefViewClient,
  consultationId: string,
  briefVersionId: string
) {
  const { error } = await client.rpc("record_preconsult_brief_view", {
    p_consultation_id: consultationId,
    p_brief_version_id: briefVersionId,
  });
  if (error) throw new Error("preconsult_view_unavailable");
}
