/**
 * Server startup hooks.
 *
 * `dns.lookup` and `fs` both run on libuv's threadpool, which defaults to four
 * threads. The transcription worker resolves a hostname for every outbound
 * provider call while also writing diagnostics, so a burst of file writes can
 * queue ahead of a DNS lookup and every provider request then waits for a free
 * thread. Production runs showed that shape exactly: a fast first call, then a
 * steady multi-second cost per request, while a small upload to a different host
 * in the same invocation stayed fast.
 *
 * Raising the pool is a mitigation, not an explanation — it is cheap, safe, and
 * removes one plausible cause while the real measurement lands.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.UV_THREADPOOL_SIZE) {
    process.env.UV_THREADPOOL_SIZE = "16";
  }
}
