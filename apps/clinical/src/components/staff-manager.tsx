"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffMember } from "@/lib/db/staff";
import styles from "@/components/clinical.module.css";

const STATE_LABEL: Record<StaffMember["accessState"], string> = {
  active: "Active",
  trial: "Trial",
  suspended: "Revoked",
};

/**
 * Staff list + create form.
 *
 * Revocation is a toggle rather than a delete: the account keeps its history and
 * can be restored, which is the whole reason access is a state and not a row.
 */
export function StaffManager({ members }: { members: StaffMember[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });

  async function setAccess(id: string, accessState: StaffMember["accessState"]) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessState }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Could not change access");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change access");
    } finally {
      setBusy(null);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Could not create the account");
      }
      setForm({ fullName: "", email: "", password: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.panelStack}>
      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <div>
            <p className={styles.eyebrow}>Your team</p>
            <h2>Reception accounts</h2>
          </div>
          <span className={styles.panelHint}>Only you can see these</span>
        </div>

        <ul className={styles.consultationList}>
          {members.map((member) => (
            <li key={member.id} className={styles.consultationRow}>
              <div className={styles.consultationRowMain}>
                <div className={styles.consultationRowHead}>
                  <strong>{member.fullName}</strong>
                  <span className={styles.panelHint}>
                    {member.isSelf ? "You" : STATE_LABEL[member.accessState]}
                  </span>
                </div>
                <span className={styles.consultationRowPreview}>{member.email}</span>
              </div>
              {!member.isSelf && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={busy === member.id}
                  onClick={() =>
                    setAccess(
                      member.id,
                      member.accessState === "suspended" ? "active" : "suspended"
                    )
                  }
                >
                  {busy === member.id
                    ? "Saving…"
                    : member.accessState === "suspended"
                      ? "Restore access"
                      : "Revoke access"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <div>
            <p className={styles.eyebrow}>Add</p>
            <h2>New reception account</h2>
          </div>
        </div>
        <p className={styles.panelHint}>
          They will see only your patients, queue and schedule — never another doctor&apos;s.
        </p>
        <form onSubmit={create} className={styles.panelStack}>
          <label>
            <span>Full name</span>
            <input
              required
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            />
          </label>
          <label>
            <span>Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label>
            <span>Temporary password</span>
            <input
              required
              minLength={8}
              type="text"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={creating}>
            {creating ? "Creating…" : "Create account"}
          </button>
        </form>
      </section>
    </div>
  );
}
