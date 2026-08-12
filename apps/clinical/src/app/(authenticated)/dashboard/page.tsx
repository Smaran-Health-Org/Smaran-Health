import Link from "next/link";
import { getSessionContext } from "@/lib/db/session";
import { getPatients } from "@/lib/db/patients";

export default async function DashboardPage() {
  const session = await getSessionContext();
  if (!session) return null;

  const { data: patients, total } = await getPatients(session.clinicId, {
    pageSize: 10,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Dashboard</h1>
          <p className="text-sm text-stone-500 mt-1">
            {session.fullName} · {session.clinicId && "Clinic"}
          </p>
        </div>
        <Link
          href="/patients/new"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          New Patient
        </Link>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search patients by name or phone…"
          className="w-full max-w-md rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          // Search will be client-side in a future iteration; for now this is a placeholder
        />
      </div>

      {/* Patient List */}
      <div className="rounded-xl border border-stone-200 bg-white">
        <div className="px-4 py-3 border-b border-stone-100">
          <span className="text-sm font-medium text-stone-700">
            Recent Patients ({total})
          </span>
        </div>

        {patients.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-stone-400">
            No patients yet. Create your first patient to get started.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {patients.map((patient) => (
              <li key={patient.id}>
                <Link
                  href={`/patients/${patient.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {patient.fullName}
                    </p>
                    <p className="text-xs text-stone-500">
                      {patient.age ? `${patient.age} yrs` : ""}
                      {patient.gender ? ` · ${patient.gender}` : ""}
                      {patient.phone ? ` · ${patient.phone}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-stone-400">
                    View →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
