import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { getPatient } from "@/lib/db/patients";
import { Avatar, Badge, consultationStatusBadge } from "@/components/ui";
import { ConsultationWorkspace } from "@/components/consultation-workspace";
import { ArrowLeftIcon, CalendarIcon, PhoneIcon } from "@/components/icons";

function formatDate(iso: Date | string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: Date | string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return null;

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) notFound();

  const patient = await getPatient(consultation.patientId, session.clinicId);
  if (!patient) notFound();

  const badge = consultationStatusBadge(consultation.status);

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in-up">
      <Link
        href={`/patients/${patient.id}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to {patient.fullName}
      </Link>

      {/* Patient + consultation header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Avatar name={patient.fullName} className="h-12 w-12 text-lg" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                {patient.fullName}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                {patient.age != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="h-4 w-4 text-slate-400" />
                    {patient.age} years
                  </span>
                )}
                {patient.gender && <span>{patient.gender}</span>}
                {patient.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <PhoneIcon className="h-4 w-4 text-slate-400" />
                    {patient.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Badge label={badge.label} variant={badge.variant} />
        </div>

        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
          Started {formatDate(consultation.startedAt)} · {formatTime(consultation.startedAt)}
        </p>
      </div>

      <ConsultationWorkspace
        consultationId={consultation.id}
        initialStatus={consultation.status}
        patientName={patient.fullName}
      />
    </div>
  );
}
