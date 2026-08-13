import Link from "next/link";
import type { Patient } from "@/types";
import { Avatar } from "@/components/ui";
import { ChevronRightIcon, PhoneIcon, MapPinIcon } from "@/components/icons";

export function PatientList({ patients }: { patients: Patient[] }) {
  if (patients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700">No patients found</p>
        <p className="mt-1 max-w-xs text-sm text-slate-400">
          Try a different search, or add your first patient to get started.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {patients.map((patient) => (
        <li key={patient.id}>
          <Link
            href={`/patients/${patient.id}`}
            className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
          >
            <Avatar name={patient.fullName} className="h-10 w-10 shrink-0 text-sm" />

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900 group-hover:text-teal-700">
                {patient.fullName}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                {patient.age != null && <span>{patient.age} yrs</span>}
                {patient.gender && <span>{patient.gender}</span>}
                {patient.phone && (
                  <span className="inline-flex items-center gap-1">
                    <PhoneIcon className="h-3 w-3" />
                    {patient.phone}
                  </span>
                )}
                {patient.address && (
                  <span className="hidden max-w-[200px] truncate items-center gap-1 lg:inline-flex">
                    <MapPinIcon className="h-3 w-3" />
                    {patient.address}
                  </span>
                )}
              </div>
            </div>

            {patient.medicalRecordNumber && (
              <span className="hidden shrink-0 rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200 sm:block">
                {patient.medicalRecordNumber}
              </span>
            )}

            <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-teal-500" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
