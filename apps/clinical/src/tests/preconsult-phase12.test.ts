import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAuditLogWithClient } from "../lib/db/audit";
import { issueAuthorizedDocumentViewUrl } from "../lib/documents/view";
import { recordPreconsultBriefViewWithClient } from "../lib/preconsult/brief-view";

test("Phase 12 audit failures are nonblocking and emit only a stable safe event", async () => {
  const output: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => output.push(values);

  try {
    await createAuditLogWithClient({
      from() {
        return {
          async insert() {
            return {
              error: {
                message: "provider failure: Priya / +919999900000 / report.pdf",
                metadata: { reasonForVisit: "sensitive intake text", privateUrl: "https://private.invalid/object" },
              },
            };
          },
        };
      },
    }, "clinic-id", "actor-id", "document.viewed", "document", "document-id", {
      filename: "report.pdf",
      patientName: "Priya",
    });

    await createAuditLogWithClient({
      from() {
        return {
          async insert() {
            throw new Error("provider failure: sensitive clinical content");
          },
        };
      },
    }, "clinic-id", "actor-id", "document.viewed", "document", "document-id");
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(output, [["audit_log_write_failed"], ["audit_log_write_failed"]]);
});

test("Phase 12 records brief views with the render-captured RLS client", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: null, error: null };
    },
  } as unknown as Parameters<typeof recordPreconsultBriefViewWithClient>[0];

  await recordPreconsultBriefViewWithClient(client, "consultation-id", "brief-version-id");
  assert.deepEqual(calls, [{
    name: "record_preconsult_brief_view",
    args: { p_consultation_id: "consultation-id", p_brief_version_id: "brief-version-id" },
  }]);
});

test("Phase 12 schedules a nonblocking brief audit without creating a request client in after", () => {
  const source = readFileSync("src/app/consultations/[id]/page.tsx", "utf8");
  assert.match(source, /const briefViewClient = await createServerClient\(\);/);
  assert.match(source, /after\(\(\) => recordPreconsultBriefViewWithClient\(\s*briefViewClient,/);
  assert.match(source, /recordPreconsultBriefViewWithClient\([\s\S]*?\)\.catch\(\(\) => undefined\)\)/);
  assert.doesNotMatch(source, /after\(\(\) =>\s*(?:await )?createServerClient\(/);
  assert.doesNotMatch(source, /after\(\(\) =>\s*recordPreconsultBriefView\(/);
});

test("Phase 12 does not record a document view when signed-url generation fails", async () => {
  const calls: string[] = [];
  await assert.rejects(
    issueAuthorizedDocumentViewUrl({ storagePath: "clinic/patient/document/original.pdf" }, {
      async createSignedUrl() {
        calls.push("sign");
        throw new Error("signing failed");
      },
      async recordView() {
        calls.push("audit");
      },
    }),
    /signing failed/
  );
  assert.deepEqual(calls, ["sign"]);
});

test("Phase 12 records a document view only after successful signing", async () => {
  const calls: string[] = [];
  const signedUrl = await issueAuthorizedDocumentViewUrl(
    { storagePath: "clinic/patient/document/original.pdf" },
    {
      async createSignedUrl(storagePath) {
        calls.push(`sign:${storagePath}`);
        return "https://signed.invalid/document";
      },
      async recordView() {
        calls.push("audit");
      },
    }
  );

  assert.equal(signedUrl, "https://signed.invalid/document");
  assert.deepEqual(calls, ["sign:clinic/patient/document/original.pdf", "audit"]);
});

test("Phase 12 preserves the safe route failure when view auditing fails after signing", async () => {
  const calls: string[] = [];
  await assert.rejects(
    issueAuthorizedDocumentViewUrl({ storagePath: "clinic/patient/document/original.pdf" }, {
      async createSignedUrl() {
        calls.push("sign");
        return "https://signed.invalid/document";
      },
      async recordView() {
        calls.push("audit");
        throw new Error("audit failed");
      },
    }),
    /audit failed/
  );
  assert.deepEqual(calls, ["sign", "audit"]);
});
