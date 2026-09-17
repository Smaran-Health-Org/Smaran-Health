"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../patient-portal.module.css";

export function PatientPortalVerificationForm({ token }: { token: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/patient/api/access/${encodeURIComponent(token)}/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "The verification code could not be accepted.");
      }
      router.push("/patient");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The verification code could not be accepted.");
    } finally {
      setPending(false);
    }
  }

  return <main className={styles.page}><section className={styles.card} aria-live="polite">
    <p className={styles.brand}>Smaran Health</p>
    <h1>Enter verification code</h1>
    <p>Enter the six-digit verification code provided by your clinic.</p>
    <form className={styles.form} onSubmit={submit}>
      <label>Verification code
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="submit" disabled={pending || code.length !== 6}>{pending ? "Verifying…" : "Continue"}</button>
    </form>
    <p className={styles.privacy}>This secure link is intended only for you. Do not forward it.</p>
  </section></main>;
}
