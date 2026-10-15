import assert from "node:assert/strict";
import test from "node:test";
import { getPendingConsultations } from "../lib/db/consultations";

function fixture(id: string, clinic_id: string, doctor_id: string, status = "draft_ready") {
  return { id, clinic_id, doctor_id, status, patient: { full_name: "Synthetic patient" }, note: [{ status: "ai_draft", content: { summary: "Synthetic draft" } }] };
}

function clientWithRows(rows: ReturnType<typeof fixture>[]) {
  return {
    from(table: string) {
      assert.equal(table, "consultations");
      let matches = rows;
      const query = {
        select() { return query; },
        eq(column: keyof ReturnType<typeof fixture>, value: string) {
          matches = matches.filter((row) => row[column] === value);
          return query;
        },
        order() { return query; },
        limit(count: number) { return Promise.resolve({ data: matches.slice(0, count), error: null }); },
      };
      return query;
    },
  } as never;
}

test("dashboard drafts are scoped to both the clinic and assigned doctor before limiting", async () => {
  const rows = [
    fixture("other-doctor", "clinic-a", "doctor-b"),
    fixture("other-clinic", "clinic-b", "doctor-a"),
    fixture("approved", "clinic-a", "doctor-a", "approved"),
    fixture("mine-1", "clinic-a", "doctor-a"),
    fixture("mine-2", "clinic-a", "doctor-a"),
    fixture("mine-3", "clinic-a", "doctor-a"),
  ];
  const result = await getPendingConsultations("clinic-a", "doctor-a", 2, clientWithRows(rows));
  assert.deepEqual(result.map((row) => row.id), ["mine-1", "mine-2"]);
  assert.equal(result[0].draftPreview, "Synthetic draft");
});

test("a doctor with no assigned drafts gets an empty backlog", async () => {
  const result = await getPendingConsultations("clinic-a", "doctor-a", 6, clientWithRows([
    fixture("other-doctor", "clinic-a", "doctor-b"),
  ]));
  assert.deepEqual(result, []);
});
