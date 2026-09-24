"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import styles from "@/components/clinical.module.css";

/**
 * Spinner shown while the enclosing <Link> is navigating. `useLinkStatus` reads
 * the pending state Next.js already tracks for the nearest <Link> ancestor, so
 * the control the user actually clicked reports progress immediately instead of
 * looking inert until the destination finishes rendering on the server.
 */
function LinkPendingSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) {
    return null;
  }
  return <span className={styles.buttonSpinner} aria-hidden="true" />;
}

export function PendingLink({
  href,
  className,
  title,
  ariaLabel,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} title={title} aria-label={ariaLabel}>
      <LinkPendingSpinner />
      {children}
    </Link>
  );
}
