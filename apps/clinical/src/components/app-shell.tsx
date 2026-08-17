"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";

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
  children,
}: {
  doctorName: string;
  clinicName: string;
  patientCount: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const isPatients = pathname.startsWith("/patients");
  const isDashboard = pathname === "/dashboard";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.brand}>
          <span aria-hidden="true">
            <Icon name="sparkle" />
          </span>
          <div>
            <strong>Smaran</strong>
            <small>Clinical memory</small>
          </div>
        </Link>

        <div className={styles.clinicSwitcher}>
          <span>{initials(clinicName)}</span>
          <div>
            <small>Workspace</small>
            <strong>{clinicName}</strong>
          </div>
          <Icon name="chevron" />
        </div>

        <nav className={styles.sideNav} aria-label="Primary navigation">
          <p>Workspace</p>
          <Link
            href="/dashboard"
            className={isDashboard ? styles.activeNav : undefined}
          >
            <Icon name="home" />
            <span>Overview</span>
          </Link>
          <Link
            href="/patients"
            className={isPatients ? styles.activeNav : undefined}
          >
            <Icon name="users" />
            <span>Patients</span>
            <small>{patientCount}</small>
          </Link>
        </nav>

        <div className={styles.doctorCard}>
          <div className={styles.doctorAvatar}>{initials(doctorName)}</div>
          <div>
            <strong>{doctorName}</strong>
            <small>Clinic account</small>
          </div>
          <button
            type="button"
            className={styles.signOutButton}
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            style={{ gridColumn: "1 / -1" }}
          >
            <Icon name="logOut" />
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </aside>

      <div className={styles.appSurface}>{children}</div>
    </div>
  );
}
