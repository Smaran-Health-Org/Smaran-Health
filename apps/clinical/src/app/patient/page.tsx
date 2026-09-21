import type { Metadata } from "next";
import { PatientPortalHome } from "./patient-portal-home";

export const metadata: Metadata = { title: "Patient portal | Smaran Health", robots: { index: false, follow: false } };

export default function PatientPortalPage() {
  return <PatientPortalHome />;
}
