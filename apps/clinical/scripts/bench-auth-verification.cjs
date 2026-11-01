/* eslint-disable @typescript-eslint/no-require-imports */
/* Measure getUser() vs getClaims() for the same session.

   The project uses ES256 asymmetric signing keys, so getClaims() can verify the
   token's signature locally against a cached JWKS instead of asking GoTrue. If
   that holds, the ~80 ms auth round trip on every request disappears.

   This is the measurement that decides whether the change is worth making, so it
   runs against the real project rather than assuming.

   Usage: node scripts/bench-auth-verification.cjs <email> <password>
*/
const REF = "traorcuxhkmpvxykfjjg";
const BASE = `https://${REF}.supabase.co`;
const [, , EMAIL, PASSWORD] = process.argv;

async function publishableKey() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  const list = await res.json();
  return (list.find((k) => k.type === "publishable") || list.find((k) => k.name === "anon")).api_key;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function time(fn, iterations = 7) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return { min: Math.round(Math.min(...samples)), median: Math.round(median(samples)), max: Math.round(Math.max(...samples)) };
}

(async () => {
  if (!EMAIL || !PASSWORD) throw new Error("Usage: node scripts/bench-auth-verification.cjs <email> <password>");
  const key = await publishableKey();

  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await login.json();
  if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 200)}`);
  const jwt = session.access_token;

  const alg = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString()).alg;
  console.log(`token alg: ${alg}\n`);

  const getUser = await time(async () => {
    const r = await fetch(`${BASE}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await r.json();
  });

  // Local verification: fetch the JWKS once (cached for 10 minutes in the SDK),
  // then verify the signature with WebCrypto. No per-request network hop.
  const crypto = require("node:crypto");
  const jwksRes = await fetch(`${BASE}/auth/v1/.well-known/jwks.json`);
  const jwks = await jwksRes.json();
  const jwk = jwks.keys.find((k) => k.kty === "EC") || jwks.keys[0];

  const localVerify = await time(async () => {
    const [header, payload, signature] = jwt.split(".");
    const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const valid = crypto.verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url")
    );
    if (!valid) throw new Error("signature invalid");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (claims.exp * 1000 < Date.now()) throw new Error("expired");
  });

  console.table([
    { method: "getUser() — network to GoTrue", ...getUser },
    { method: "getClaims() — local JWKS verify", ...localVerify },
  ]);
  console.log(`\nsaving per auth check: ~${getUser.median - localVerify.median} ms`);
  console.log("The middleware and getSessionContext each perform one auth check per request.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
