import { redirect } from "next/navigation";

// Preserve old Scheduler entry links while keeping one canonical staff flow.
export default function LegacyDoctorsRoute() {
  redirect("/scheduler");
}