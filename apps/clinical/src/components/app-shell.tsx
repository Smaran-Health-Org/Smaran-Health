"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui";
import {
  HomeIcon,
  UsersIcon,
  StethoscopeIcon,
  FileTextIcon,
  CalendarClockIcon,
  SettingsIcon,
  PlusIcon,
  LogOutIcon,
} from "@/components/icons";

type AppUser = {
  fullName: string;
  role: string;
  email: string;
};

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/patients", label: "Patients", icon: UsersIcon },
];

const comingSoon = [
  { label: "Consultations", icon: StethoscopeIcon },
  { label: "Clinical Notes", icon: FileTextIcon },
  { label: "Follow-ups", icon: CalendarClockIcon },
  { label: "Settings", icon: SettingsIcon },
];

function LogoMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
      <StethoscopeIcon className="h-5 w-5" />
    </span>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: AppUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <div className="flex min-h-screen">
        {/* ── Sidebar (desktop) ─────────────────────────────────────────── */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <LogoMark />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Smaran Health</p>
              <p className="text-xs text-slate-400">Clinical workspace</p>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-3 pt-2">
            {primaryNav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-teal-50 text-teal-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <item.icon
                    className={`h-[18px] w-[18px] ${
                      active ? "text-teal-600" : "text-slate-400 group-hover:text-slate-500"
                    }`}
                  />
                  {item.label}
                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-teal-500" />
                  )}
                </Link>
              );
            })}

            <div className="px-3 pb-2 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Coming soon
              </p>
            </div>
            {comingSoon.map((item) => (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300"
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                  Soon
                </span>
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-100 p-3">
            <Link
              href="/patients/new"
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
            >
              <PlusIcon className="h-4 w-4" />
              New Patient
            </Link>

            <div className="mt-3 flex items-center gap-3 rounded-lg px-2 py-2">
              <Avatar name={user.fullName} className="h-9 w-9 text-sm" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium text-slate-800">
                  {user.fullName}
                </p>
                <p className="truncate text-xs capitalize text-slate-400">
                  {user.role}
                </p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
            >
              <LogOutIcon className="h-4 w-4" />
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>

        {/* ── Main column ──────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
              {/* Mobile logo */}
              <div className="flex items-center gap-2 md:hidden">
                <LogoMark />
              </div>

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium text-slate-800">{user.fullName}</p>
                  <p className="text-xs capitalize text-slate-400">{user.role}</p>
                </div>
                <Avatar name={user.fullName} className="h-9 w-9 text-sm" />
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  title="Sign out"
                  className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 md:hidden"
                >
                  <LogOutIcon className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {/* Mobile nav */}
            <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1 md:hidden">
              {primaryNav.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                      active
                        ? "bg-teal-50 text-teal-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/patients/new"
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
              >
                <PlusIcon className="h-4 w-4" />
                New Patient
              </Link>
            </nav>
          </header>

          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
