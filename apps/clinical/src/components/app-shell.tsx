"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";
import type { SessionContext } from "@/types";

// Idle timeout in ms — auto sign-out after inactivity (PHI safety). Default 30
// minutes, overridable via NEXT_PUBLIC_SESSION_INACTIVITY_MINUTES.
const INACTIVITY_MS = (() => {
  const minutes = Number(
    process.env.NEXT_PUBLIC_SESSION_INACTIVITY_MINUTES ?? 30
  );
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  return safe * 60 * 1000;
})();

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
  const signingOutRef = useRef(false);
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

  const handleSignOut = useCallback(
    async (reason?: "expired") => {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      setSigningOut(true);
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } finally {
        router.push(reason === "expired" ? "/login?expired=1" : "/login");
        router.refresh();
      }
    },
    [router]
  );

  // Idle timeout: sign out after inactivity so a stale session isn't left open
  // on a shared or unattended device. Any pointer/keyboard/scroll activity
  // resets the countdown.
  //
  // We compare against a real `lastActivity` timestamp and re-check on a short
  // interval (instead of a single long setTimeout), so browser throttling of
  // timers in background tabs can't silently keep a session alive for many
  // extra minutes. Returning to a hidden tab triggers an immediate re-check.
  useEffect(() => {
    const activityEvents = [
      "pointerdown",
      "keydown",
      "mousemove",
      "scroll",
      "touchstart",
    ] as const;
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, Math.min(INACTIVITY_MS, 30_000));
    }

    function check() {
      if (Date.now() - lastActivity >= INACTIVITY_MS) {
        handleSignOut("expired");
        return;
      }
      schedule();
    }

    function onActivity() {
      lastActivity = Date.now();
      schedule();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") check();
    }

    schedule();
    activityEvents.forEach((event) =>
      window.addEventListener(event, onActivity, { passive: true })
    );
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer) clearTimeout(timer);
      activityEvents.forEach((event) =>
        window.removeEventListener(event, onActivity)
      );
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [handleSignOut]);

  const isPatients = pathname.startsWith("/patients");
  const isDashboard = pathname === "/dashboard";
  const isDesk = pathname === "/desk" || pathname.startsWith("/desk/");
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
              >
                <Icon name="home" />
                <span>Today</span>
              </Link>
              <Link
                href="/patients"
                className={isPatients ? styles.activeNav : undefined}
              >
                <Icon name="users" />
                <span>Patients</span>
                <small>{patientCount}</small>
              </Link>
            </>
          ) : (
            <>
              <Link href="/desk" className={isDesk ? styles.activeNav : undefined}>
                <Icon name="home" />
                <span>Today</span>
              </Link>
              <span className={styles.disabledNav} aria-disabled="true">
                <Icon name="calendar" />
                <span>Scheduler</span>
                <small>Later</small>
              </span>
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
                    <Link data-active={workspace === "clinical"} href="/dashboard">Clinical</Link>
                    <Link data-active={workspace === "desk"} href="/desk">Clinic Desk</Link>
                  </div>
                ) : (
                  <strong>Clinic Desk</strong>
                )}
              </div>
              <button
                type="button"
                className={styles.accountSignOut}
                onClick={() => handleSignOut()}
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
