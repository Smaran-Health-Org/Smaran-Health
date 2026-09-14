"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Bounded backoff refresh while server-reported asynchronous work is active. */
export function PreconsultLifecycleRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const attempt = useRef(0);
  useEffect(() => {
    if (!active) { attempt.current = 0; return; }
    const delay = Math.min(15_000, 3_000 * (attempt.current + 1));
    const timer = window.setTimeout(() => { attempt.current += 1; router.refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [active, router]);
  return null;
}
