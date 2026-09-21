import type { Metadata } from "next";
import { PatientPortalVerificationForm } from "./patient-portal-verification-form";

export const metadata: Metadata = {
  title: "Secure patient portal | Smaran Health",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PatientPortalAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PatientPortalVerificationForm token={token} />;
}
