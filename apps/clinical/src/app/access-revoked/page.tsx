import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { isAccessUsable } from "@/lib/auth/capabilities";

export const metadata = { title: "Access revoked | Smaran Health", robots: { index: false, follow: false } };

/**
 * Terminal page for a suspended account.
 *
 * Kept outside the authenticated shell on purpose: the shell renders navigation
 * into workspaces the account can no longer use, so every link would bounce back
 * here.
 */
export default async function AccessRevokedPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (isAccessUsable(session.accessState)) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold text-stone-900">Access revoked</h1>
        <p className="mb-6 text-sm text-stone-600">
          Your Smaran access has been withdrawn. Your clinic&apos;s records are untouched — ask
          the doctor who invited you to restore it.
        </p>
        <dl className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-stone-500">Signed in as</dt>
            <dd className="truncate font-medium text-stone-800">{session.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-stone-500">Status</dt>
            <dd className="font-medium text-stone-800">Suspended</dd>
          </div>
        </dl>
        <Link
          href="/login"
          className="block w-full rounded-md bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Sign in with another account
        </Link>
      </div>
    </main>
  );
}
