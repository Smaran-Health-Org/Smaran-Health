/* Measure the round trips every authenticated request pays for.

   The app has no caching layer, so page latency is roughly the sum of sequential
   provider calls. This measures each one from the outside so the numbers are not
   inferred:

     1. Supabase Auth   /auth/v1/user        (middleware + getSessionContext)
     2. Supabase REST   /rest/v1/profiles    (middleware access check + session)
     3. Supabase REST   /rest/v1/clinics     (a page-level read)
     4. Production TTFB on a public page
     5. Sarvam control-call latency, for comparison

   Usage: node scripts/bench-request-path.cjs <email> <password>
*/
const REF = "traorcuxhkmpvxykfjjg";
const BASE = `https://${REF}.supabase.co`;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const [, , EMAIL, PASSWORD] = process.argv;

async function publishableKey() {
  if (PUBLISHABLE) return PUBLISHABLE;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const list = await res.json();
  return (list.find((k) => k.type === "publishable") || list.find((k) => k.name === "anon")).api_key;
}

async function timed(label, fn) {
  const start = process.hrtime.bigint();
  let note = "";
  try {
    note = await fn();
  } catch (e) {
    note = `error: ${e.message}`;
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, ms: Math.round(ms), note: String(note).slice(0, 70) };
}

async function run(label, fn, iterations = 5) {
  const samples = [];
  let note = "";
  for (let i = 0; i < iterations; i += 1) {
    const r = await timed(label, fn);
    samples.push(r.ms);
    note = r.note;
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    min: samples[0],
    median: samples[Math.floor(samples.length / 2)],
    max: samples[samples.length - 1],
    note,
  };
}

(async () => {
  if (!TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  if (!EMAIL || !PASSWORD) throw new Error("Usage: node scripts/bench-request-path.cjs <email> <password>");

  const key = await publishableKey();

  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await login.json();
  if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 200)}`);
  const jwt = session.access_token;

  const results = [];

  results.push(
    await run("supabase auth getUser", async () => {
      const r = await fetch(`${BASE}/auth/v1/user`, {
        headers: { apikey: key, Authorization: `Bearer ${jwt}` },
      });
      return `HTTP ${r.status}`;
    })
  );

  results.push(
    await run("supabase profiles (access check)", async () => {
      const r = await fetch(`${BASE}/rest/v1/profiles?select=access_state&&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${jwt}` },
      });
      return `HTTP ${r.status}`;
    })
  );

  results.push(
    await run("supabase clinics (page read)", async () => {
      const r = await fetch(`${BASE}/rest/v1/clinics?select=name&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${jwt}` },
      });
      return `HTTP ${r.status}`;
    })
  );

  results.push(
    await run(
      "production /login TTFB",
      async () => {
        const r = await fetch("https://smaranhealth.com/login", { cache: "no-store" });
        await r.text();
        return `HTTP ${r.status}`;
      },
      3
    )
  );

  results.push(
    await run(
      "sarvam control call",
      async () => {
        const r = await fetch("https://api.sarvam.ai/speech-to-text/job/v1/probe/status", {
          headers: { "api-subscription-key": process.env.SARVAM_API_KEY || "" },
        });
        return `HTTP ${r.status}`;
      },
      3
    )
  );

  console.table(results);

  const supabaseMedian = results
    .filter((r) => r.label.startsWith("supabase"))
    .reduce((sum, r) => sum + r.median, 0);
  console.log(`\nSequential Supabase cost for one request path: ~${supabaseMedian} ms`);
  console.log("A page that reads 6 datasets without dedupe pays that per read.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
