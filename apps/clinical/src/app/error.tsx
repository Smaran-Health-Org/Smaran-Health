"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-stone-900">Something went wrong</h2>
        <p className="mt-1 text-sm text-stone-500">{error.message || "An unexpected error occurred"}</p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
