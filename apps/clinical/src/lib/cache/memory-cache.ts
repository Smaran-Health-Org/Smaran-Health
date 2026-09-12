// Cross-request in-memory TTL cache for warm serverless instances.
//
// Deliberately NOT Next's `unstable_cache`: those cached functions must not
// read request-scoped data (cookies/headers), but our DB helpers authenticate
// through the user's JWT read from cookies (so RLS applies). A process-local
// cache avoids that conflict while still skipping repeat round-trips when a
// warm instance serves several requests in quick succession (e.g. a doctor
// clicking between pages).
//
// Values are tenant/user-scoped by their cache key, so data is never shared
// across tenants or users. Non-persistent: resets on cold start and is
// per-instance — it is a latency accelerator, not a source of truth.

type Entry = { value: unknown; expiresAt: number };

const globalForCache = globalThis as { __smaranCache?: Map<string, Entry> };
const store = (globalForCache.__smaranCache ??= new Map<string, Entry>());
const inflight = new Map<string, Promise<unknown>>();

export function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return Promise.resolve(hit.value as T);
  }

  // Dedupe concurrent loads on the same instance (avoids a thundering herd
  // when several requests miss at once).
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = load()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export function invalidate(key: string): void {
  store.delete(key);
}
