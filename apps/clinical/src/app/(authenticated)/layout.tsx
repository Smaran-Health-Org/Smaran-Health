import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/db/session";

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
    <div className="min-h-screen bg-stone-50">
      <nav className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold text-emerald-700">
              Smaran Health
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-stone-600 hover:text-stone-900"
            >
              Dashboard
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-stone-500">
              {session.fullName}
            </span>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
