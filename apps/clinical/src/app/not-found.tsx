import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-stone-300">404</h1>
        <p className="mt-2 text-sm text-stone-500">Page not found</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
