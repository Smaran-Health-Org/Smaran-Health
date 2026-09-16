"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";
import type { SessionContext } from "@/types";

function initials(name: string): string {
  return name
    .replace(/^(Dr\.?|Doctor)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppShell({
  doctorName,
  clinicName,
  patientCount,
  role = "doctor",
  workspace = "clinical",
  children,
}: {
  doctorName: string;
  clinicName: string;
  patientCount: number;
  role?: SessionContext["role"];
  workspace?: "clinical" | "desk";
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      const menu = accountMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.removeAttribute("open");
      }
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    return () => document.removeEventListener("pointerdown", closeAccountMenu);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const isPatients = pathname.startsWith("/patients") || pathname.startsWith("/desk/patients");
  const isDashboard = pathname === "/dashboard";
  const isDeskHome = pathname === "/desk";
  const isScheduler = pathname === "/scheduler";
  const homeHref = workspace === "desk" ? "/desk" : "/dashboard";
  const workspaceLabel = workspace === "desk" ? "Clinic Desk" : "Clinical";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href={homeHref} className={styles.brand}>
          <span aria-hidden="true">
            <Icon name="sparkle" />
          </span>
          <div>
            <strong>Smaran</strong>
            <small>{workspaceLabel} workspace</small>
          </div>
        </Link>

        <nav className={styles.sideNav} aria-label="Primary navigation">
          <p>Workspace</p>
          {workspace === "clinical" ? (
            <>
              <Link
                href="/dashboard"
                className={isDashboard ? styles.activeNav : undefined}
                aria-label="Today"
                title="Today"
              >
                <Icon name="home" />
                <span>Today</span>
              </Link>
              <Link href="/scheduler" className={isScheduler ? styles.activeNav : undefined} aria-label="Scheduler" title="Scheduler">
                <Icon name="calendar" />
                <span>Scheduler</span>
              </Link>
              <Link
                href="/patients"
                className={isPatients ? styles.activeNav : undefined}
                aria-label="Patients"
                title="Patients"
              >
                <Icon name="users" />
                <span>Patients</span>
                <small>{patientCount}</small>
              </Link>
            </>
          ) : (
            <>
              <Link href="/desk" className={isDeskHome ? styles.activeNav : undefined} aria-label="Today" title="Today">
                <Icon name="home" />
                <span>Today</span>
              </Link>
              <Link href="/desk/patients" className={isPatients ? styles.activeNav : undefined} aria-label="Patients" title="Patients">
                <Icon name="users" />
                <span>Patients</span>
                <small>{patientCount}</small>
              </Link>
              <Link href="/scheduler" className={isScheduler ? styles.activeNav : undefined} aria-label="Scheduler" title="Scheduler">
                <Icon name="calendar" />
                <span>Scheduler</span>
              </Link>
            </>
          )}
        </nav>

      </aside>

      <div className={styles.appSurface}>
        <div className={styles.accountBar}>
          <details className={styles.accountMenu} ref={accountMenuRef}>
            <summary aria-label="Open profile menu">
              <span className={styles.doctorAvatar}>{initials(doctorName)}</span>
            </summary>
            <div className={styles.accountPopover}>
              <div className={styles.accountIdentity}>
                <span className={styles.doctorAvatar}>{initials(doctorName)}</span>
                <div>
                  <strong>{doctorName}</strong>
                  <small>{role === "doctor" ? "Doctor" : role === "admin" ? "Admin" : "Clinic assistant"}</small>
                </div>
              </div>
              <div className={styles.workspaceDetails}>
                <span>{initials(clinicName)}</span>
                <div>
                  <small>Active clinic</small>
                  <strong>{clinicName}</strong>
                </div>
              </div>
              <div className={styles.workspaceSwitch}>
                <small>Workspace</small>
                {role === "doctor" ? (
                  <div>
                    <Link data-active={workspace === "clinical"} href="/dashboard">Doctor</Link>
                    <Link data-active={workspace === "desk"} href="/desk">Receptionist</Link>
                  </div>
                ) : (
                  <strong>Clinic Desk</strong>
                )}
              </div>
              <button
                type="button"
                className={styles.accountSignOut}
                onClick={handleSignOut}
                disabled={signingOut}
              >
                <Icon name="logOut" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </details>
        </div>
        {children}
      </div>
    </div>
  );
}
