import type { Metadata } from "next";
import { PatientIntakeForm } from "./patient-intake-form";

export const metadata: Metadata = {
  title: "Secure patient intake | Smaran Health",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PatientIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PatientIntakeForm token={token} />;
}
