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
  const mobileNavigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const navigation = mobileNavigationRef.current;
    if (!navigation) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--mobile-navigation-space");
    const measure = () => {
      const height = navigation.getBoundingClientRect().height;
      // The rendered height includes any padding. The computed bottom offset
      // includes the safe-area gap, so neither is counted twice.
      const bottom = height > 0 ? Number.parseFloat(getComputedStyle(navigation).bottom) || 0 : 0;
      root.style.setProperty("--mobile-navigation-space", `${Math.ceil(height + bottom)}px`);
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(navigation);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      if (previous) root.style.setProperty("--mobile-navigation-space", previous);
      else root.style.removeProperty("--mobile-navigation-space");
    };
  }, []);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      const menu = accountMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.removeAttribute("open");
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      const menu = accountMenuRef.current;
      if (event.key === "Escape" && menu?.open) {
        menu.removeAttribute("open");
        menu.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
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
  const isScheduler = pathname.startsWith("/scheduler");
  const homeHref = workspace === "desk" ? "/desk" : "/dashboard";
  const patientsHref = workspace === "desk" ? "/desk/patients" : "/patients";
  const schedulerHref = workspace === "desk" ? "/scheduler?workspace=desk" : "/scheduler?workspace=clinical";
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

        <div className={styles.shellClinic}>
          <span>{initials(clinicName)}</span>
          <div>
            <small>Active clinic</small>
            <strong>{clinicName}</strong>
          </div>
        </div>

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
              <Link href={schedulerHref} className={isScheduler ? styles.activeNav : undefined} aria-label="Scheduler" title="Scheduler">
                <Icon name="calendar" />
                <span>Scheduler</span>
              </Link>
              <Link
                href={patientsHref}
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
              <Link href={patientsHref} className={isPatients ? styles.activeNav : undefined} aria-label="Patients" title="Patients">
                <Icon name="users" />
                <span>Patients</span>
                <small>{patientCount}</small>
              </Link>
              <Link href={schedulerHref} className={isScheduler ? styles.activeNav : undefined} aria-label="Scheduler" title="Scheduler">
                <Icon name="calendar" />
                <span>Scheduler</span>
              </Link>
            </>
          )}
        </nav>

      </aside>

      <div className={styles.appSurface}>
        <div className={styles.accountBar}>
          <div className={styles.accountContext}>
            <span>{workspaceLabel}</span>
            <strong>{clinicName}</strong>
          </div>
          <div className={styles.accountBarRight}>
            {role === "doctor" ? (
              <nav className={styles.accountWorkspaceSwitch} aria-label="Switch workspace">
                <Link href="/desk" data-active={workspace === "desk"} title="Reception workspace">Reception</Link>
                <Link href="/dashboard" data-active={workspace === "clinical"} title="Doctor workspace">Doctor</Link>
              </nav>
            ) : null}
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
        </div>
        {children}
      </div>

      <nav ref={mobileNavigationRef} className={styles.mobileNav} aria-label="Mobile navigation">
        <Link href={homeHref} data-active={isDashboard || isDeskHome} aria-current={isDashboard || isDeskHome ? "page" : undefined}><Icon name="home" /><span>Today</span></Link>
        <Link href={schedulerHref} data-active={isScheduler} aria-current={isScheduler ? "page" : undefined}><Icon name="calendar" /><span>Schedule</span></Link>
        <Link href={patientsHref} data-active={isPatients} aria-current={isPatients ? "page" : undefined}><Icon name="users" /><span>Patients</span></Link>
      </nav>
    </div>
  );
}
