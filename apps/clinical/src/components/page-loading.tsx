// Calm full-page skeleton shown by per-route `loading.tsx` files while an
// async Server Component resolves. Paints immediately so navigation never
// leaves a blank white screen.

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="flex flex-col items-center gap-3 text-stone-500">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"
          aria-hidden="true"
        />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}
