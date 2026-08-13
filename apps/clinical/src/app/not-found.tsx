import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <p className="text-6xl font-bold tracking-tight text-slate-200">404</p>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Page not found</h1>
        <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
