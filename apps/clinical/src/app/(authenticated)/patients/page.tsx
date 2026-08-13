import Link from "next/link";
import { getSessionContext } from "@/lib/db/session";
import { getPatients } from "@/lib/db/patients";
import { Card } from "@/components/ui";
import { PatientList } from "@/components/patient-list";
import { SearchIcon, PlusIcon } from "@/components/icons";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await getSessionContext();
  if (!session) return null;

  const { data: patients, total } = await getPatients(session.clinicId, {
    search: q || undefined,
    pageSize: 50,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Patients
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} patient{total === 1 ? "" : "s"} in your clinic
          </p>
        </div>
        <Link
          href="/patients/new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
        >
          <PlusIcon className="h-4 w-4" />
          New Patient
        </Link>
      </div>

      <Card className="overflow-hidden">
        {/* Search */}
        <form
          action="/patients"
          method="get"
          className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"
        >
          <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name or phone…"
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {q && (
            <Link
              href="/patients"
              className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              Clear
            </Link>
          )}
        </form>

        <PatientList patients={patients} />
      </Card>
    </div>
  );
}
