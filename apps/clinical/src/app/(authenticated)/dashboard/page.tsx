import Link from "next/link";
import { getSessionContext } from "@/lib/db/session";
import { getPatients } from "@/lib/db/patients";
import { getDashboardStats } from "@/lib/db/stats";
import { getRecentConsultations } from "@/lib/db/consultations";
import { Card, consultationStatusBadge, Badge } from "@/components/ui";
import { PatientList } from "@/components/patient-list";
import {
  UsersIcon,
  StethoscopeIcon,
  CalendarClockIcon,
  FileTextIcon,
  SearchIcon,
  PlusIcon,
  ArrowLeftIcon,
  ClockIcon,
} from "@/components/icons";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(fullName: string): string {
  // Strip a leading title ("Dr.", "Mr.", etc.) so we don't greet "Dr. Dr.".
  const cleaned = fullName.replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").trim();
  return cleaned.split(" ")[0] || fullName;
}

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

type StatCardProps = {
  label: string;
  value: number;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: string;
};

function StatCard({ label, value, icon: Icon, accent }: StatCardProps) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${accent}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-semibold leading-none text-slate-900">{value}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await getSessionContext();
  if (!session) return null;

  const [stats, { data: patients, total }, recentConsultations] = await Promise.all([
    getDashboardStats(session.clinicId),
    getPatients(session.clinicId, { search: q || undefined, pageSize: 8 }),
    getRecentConsultations(session.clinicId, 5),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {greeting()}, Dr. {firstName(session.fullName)}
          </h1>
        </div>
        <Link
          href="/patients/new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
        >
          <PlusIcon className="h-4 w-4" />
          New Patient
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total patients"
          value={stats.totalPatients}
          icon={UsersIcon}
          accent="bg-teal-50 text-teal-600"
        />
        <StatCard
          label="Consultations this week"
          value={stats.consultationsThisWeek}
          icon={StethoscopeIcon}
          accent="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="Total consultations"
          value={stats.totalConsultations}
          icon={CalendarClockIcon}
          accent="bg-violet-50 text-violet-600"
        />
        <StatCard
          label="Approved notes"
          value={stats.approvedNotes}
          icon={FileTextIcon}
          accent="bg-emerald-50 text-emerald-600"
        />
      </div>

      {/* Recent consultations */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Recent consultations</h2>

        {recentConsultations.length === 0 ? (
          <Card className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <StethoscopeIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-slate-700">No consultations yet</p>
            <p className="mt-1 max-w-xs text-sm text-slate-400">
              Open a patient profile and start a consultation to begin.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {recentConsultations.map((c) => {
                const badge = consultationStatusBadge(c.status);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/consultations/${c.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                        <StethoscopeIcon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {c.patientFullName ?? "Unknown patient"}
                        </p>
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-400">
                          <ClockIcon className="h-3 w-3" />
                          {formatDate(c.startedAt)} · {formatTime(c.startedAt)}
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
      </div>

      {/* Patients */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Recent patients</h2>
          <Link
            href="/patients"
            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800"
          >
            View all
            <ArrowLeftIcon className="h-3.5 w-3.5 rotate-180" />
          </Link>
        </div>

        <Card className="overflow-hidden">
          {/* Search */}
          <form
            action="/dashboard"
            method="get"
            className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"
          >
            <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search patients by name or phone…"
              className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {q && (
              <Link
                href="/dashboard"
                className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Clear
              </Link>
            )}
          </form>

          {q ? (
            <div className="px-5 py-2.5 text-xs text-slate-500">
              {total} result{total === 1 ? "" : "s"} for &ldquo;{q}&rdquo;
            </div>
          ) : null}

          <PatientList patients={patients} />
        </Card>
      </div>
    </div>
  );
}
