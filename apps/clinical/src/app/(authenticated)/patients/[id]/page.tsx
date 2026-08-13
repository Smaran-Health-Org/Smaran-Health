import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getPatient } from "@/lib/db/patients";
import { getConsultations } from "@/lib/db/consultations";
import { Avatar, Badge, Card, consultationStatusBadge } from "@/components/ui";
import { StartConsultationButton } from "@/components/start-consultation";
import {
  ArrowLeftIcon,
  PhoneIcon,
  MapPinIcon,
  CalendarIcon,
  StethoscopeIcon,
  ClockIcon,
} from "@/components/icons";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in-up">
      {/* Back link */}
      <Link
        href="/patients"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Patients
      </Link>

      {/* Patient Header */}
      <Card className="overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-teal-500 to-emerald-500" />
        <div className="p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <Avatar name={patient.fullName} className="h-14 w-14 text-xl" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {patient.fullName}
                  </h1>
                  {patient.medicalRecordNumber && (
                    <Badge label={`MRN ${patient.medicalRecordNumber}`} variant="info" />
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-500">
                  {patient.age != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarIcon className="h-4 w-4 text-slate-400" />
                      {patient.age} years
                    </span>
                  )}
                  {patient.gender && (
                    <span className="inline-flex items-center gap-1.5">
                      {patient.gender}
                    </span>
                  )}
                  {patient.phone && (
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneIcon className="h-4 w-4 text-slate-400" />
                      {patient.phone}
                    </span>
                  )}
                </div>

                {patient.address && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-400">
                    <MapPinIcon className="h-4 w-4" />
                    {patient.address}
                  </p>
                )}
              </div>
            </div>

            <StartConsultationButton patientId={patient.id} />
          </div>
        </div>
      </Card>

      {/* Consultation History */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <StethoscopeIcon className="h-4 w-4 text-slate-400" />
          <h2 className="text-base font-semibold text-slate-900">
            Consultation history
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {consultations.length}
          </span>
        </div>

        {consultations.length === 0 ? (
          <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <StethoscopeIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-slate-700">No consultations yet</p>
            <p className="mt-1 max-w-xs text-sm text-slate-400">
              Start a consultation to begin recording this patient&rsquo;s visits.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {consultations.map((c) => {
                const badge = consultationStatusBadge(c.status);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/consultations/${c.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                        <StethoscopeIcon className="h-5 w-5" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {formatDate(c.startedAt)}
                        </p>
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-400">
                          <ClockIcon className="h-3 w-3" />
                          {formatTime(c.startedAt)}
                          {c.endedAt && <> &middot; {formatTime(c.endedAt)}</>}
                        </p>
                      </div>

                      <Badge label={badge.label} variant={badge.variant} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
