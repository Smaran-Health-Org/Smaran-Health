import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { AppShell } from "@/components/app-shell";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionContext();

  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell
      user={{
        fullName: session.fullName,
        role: session.role,
        email: session.email,
      }}
    >
      {children}
    </AppShell>
  );
}
