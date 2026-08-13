import { redirect } from "next/navigation";

// The real app lives under the (authenticated) route group at /dashboard.
// Root route just forwards to the dashboard; the authenticated layout will
// bounce unauthenticated visitors to /login.
export default function Home() {
  redirect("/dashboard");
}
