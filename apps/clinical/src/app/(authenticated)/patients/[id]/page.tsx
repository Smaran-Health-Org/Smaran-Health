import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getPatient } from "@/lib/db/patients";
import { getConsultations } from "@/lib/db/consultations";

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return null;

  const patient = await getPatient(id, session.clinicId);
  if (!patient) notFound();

  const consultations = await getConsultations(id, session.clinicId);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="text-sm text-stone-500 hover:text-stone-700"
      >
        ← Back to Dashboard
      </Link>

      {/* Patient Header */}
      <div className="rounded-xl border border-stone-200 bg-white p-6">
        <h1 className="text-2xl font-semibold text-stone-900">
          {patient.fullName}
        </h1>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-stone-500">
          {patient.age && <span>{patient.age} years</span>}
          {patient.gender && <span>· {patient.gender}</span>}
          {patient.phone && <span>· {patient.phone}</span>}
          {patient.medicalRecordNumber && (
            <span>· MRN: {patient.medicalRecordNumber}</span>
          )}
        </div>
        {patient.address && (
          <p className="mt-1 text-sm text-stone-400">{patient.address}</p>
        )}
      </div>

      {/* Start Consultation */}
      <form
        action={async () => {
          "use server";
          // Will be wired when API routes exist
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          Start Consultation
        </button>
      </form>

      {/* Consultation History */}
      <div>
        <h2 className="text-lg font-medium text-stone-900 mb-3">
          Consultation History
        </h2>

        {consultations.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-12 text-center text-sm text-stone-400">
            No consultations yet.
          </div>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
            {consultations.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-900">
                    {new Date(c.startedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-stone-500">
                    {new Date(c.startedAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-stone-100 text-stone-600 font-medium">
                  {c.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
