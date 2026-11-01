/* Exercises the middleware's two paths against a running local server.

   The failure this guards against: `getClaims()` rejects when the request has no
   session, and an unhandled rejection inside edge middleware takes the whole site
   down with MIDDLEWARE_INVOCATION_FAILED — including the login page, so nobody
   can sign in to recover. That only shows up on an *unauthenticated* request,
   which is why it is tested explicitly.

   Usage: node scripts/test-middleware-session-paths.cjs [baseUrl]
*/
const BASE = process.argv[2] || "http://localhost:3210";

async function hit(path, headers = {}) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
    const body = await res.text();
    return {
      path,
      status: res.status,
      ms: Date.now() - start,
      location: res.headers.get("location") || "",
      note: res.status === 500 ? body.replace(/\s+/g, " ").slice(0, 160) : "",
    };
  } catch (e) {
    return { path, status: "ERR", ms: Date.now() - start, location: "", note: e.message.slice(0, 160) };
  }
}

(async () => {
  const results = [];

  // 1. No cookie at all — the case that crashed edge middleware.
  results.push(await hit("/login"));
  // 2. A protected page with no cookie: must redirect, not 500.
  results.push(await hit("/dashboard"));
  // 3. An API route with no cookie: must return 401 JSON, not 500.
  results.push(await hit("/api/scheduler/calendar"));
  // 4. A garbage session cookie: must be treated as unauthenticated, not throw.
  results.push(
    await hit("/dashboard", {
      cookie: "sb-traorcuxhkmpvxykfjjg-auth-token=not-a-real-jwt",
    })
  );

  console.table(results);

  const crashed = results.filter((r) => r.status === 500 || r.status === "ERR");
  console.log(
    crashed.length === 0
      ? "\nAll session paths answered without a server error."
      : `\n${crashed.length} path(s) failed — see above.`
  );
  process.exit(crashed.length === 0 ? 0 : 1);
})();
