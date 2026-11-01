/* Compare server response time for the same authenticated page across two
   deployments, using one real session cookie.

   This is the honest before/after measurement: same user, same session, same
   page, same client, same time window. Only the code differs.

   Usage:
     node scripts/bench-deployed-pages.cjs <cookie> <oldBase> <newBase> [path]
*/
const [, , COOKIE, OLD_BASE, NEW_BASE, PATH = "/dashboard"] = process.argv;

if (!COOKIE || !OLD_BASE || !NEW_BASE) {
  console.error("Usage: node scripts/bench-deployed-pages.cjs <cookie> <oldBase> <newBase> [path]");
  process.exit(1);
}

async function sample(base, path, runs = 9) {
  const times = [];
  let status = 0;
  let bytes = 0;

  // One warm-up request, discarded: the first hit pays for a cold lambda and a
  // cold JWKS fetch, which would otherwise dominate the median on both sides.
  for (let i = 0; i < runs + 1; i += 1) {
    const start = process.hrtime.bigint();
    const res = await fetch(`${base}${path}`, {
      headers: { cookie: COOKIE, "cache-control": "no-cache" },
      redirect: "manual",
    });
    const body = await res.text();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    status = res.status;
    bytes = body.length;
    if (i > 0) times.push(ms);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    status,
    bytes,
    min: Math.round(sorted[0]),
    median: Math.round(median),
    max: Math.round(sorted[sorted.length - 1]),
    runs: times.length,
  };
}

(async () => {
  const oldResult = await sample(OLD_BASE, PATH);
  const newResult = await sample(NEW_BASE, PATH);

  console.table([
    { deployment: "before", base: OLD_BASE.replace("https://", ""), ...oldResult },
    { deployment: "after", base: NEW_BASE.replace("https://", ""), ...newResult },
  ]);

  const delta = oldResult.median - newResult.median;
  const pct = oldResult.median ? Math.round((delta / oldResult.median) * 100) : 0;
  console.log(`\n${PATH} median: ${oldResult.median} ms -> ${newResult.median} ms`);
  console.log(`saved: ${delta} ms per request (${pct}%)`);
  console.log(
    oldResult.status === newResult.status
      ? `both returned HTTP ${oldResult.status}; comparable`
      : `WARNING: status differs (${oldResult.status} vs ${newResult.status}); not comparable`
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
