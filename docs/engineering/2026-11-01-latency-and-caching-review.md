# Latency and caching review — 1 November 2026

Measured against the live pilot stack (Vercel `smaran-health`, region `bom1`; Supabase
`traorcuxhkmpvxykfjjg`, region `ap-south-1`) from a client in India. Every number below
came from a script in `apps/clinical/scripts/`, so it can be reproduced rather than
taken on trust.

## 1. Sarvam transcription

**Works.** Verified end to end with a real multipart upload, not just a credentials check:

| Check | Result |
| --- | --- |
| `SARVAM_API_KEY` present in Vercel (prod + preview) | was **missing**; now set |
| Key validity | **valid** — malformed requests return `invalid_request_error` (400), not `invalid_api_key_error` (403) |
| `POST /speech-to-text`, `saaras:v3`, 2 s WAV | **HTTP 200**, `language_code: "en-IN"`, 360 ms |
| DNS for `api.sarvam.ai` | 10 ms |
| First call (cold TLS) | ~204 ms |
| Warm call | ~26–78 ms |

Reproduce with `node scripts/test-sarvam-e2e.cjs <key>` and
`node scripts/probe-sarvam-latency.cjs <key>`.

Sarvam is not a latency problem. It is fast and it was simply unconfigured, which means
**recording transcription had never worked in production** — there was no key for it to
call. That was a configuration gap, not a code defect, and it would have surfaced as a
failing visit rather than a slow one.

## 2. Where the latency actually is

One authenticated page load pays for these round trips, sequentially:

| Step | Median | Note |
| --- | --- | --- |
| Middleware `getUser()` | ~63–82 ms | GoTrue `/auth/v1/user` |
| Middleware `profiles` read (`access_state`) | ~104 ms | suspended-account check |
| `getSessionContext` `getUser()` | ~63–82 ms | **now removed** |
| `getSessionContext` `profiles` read | ~104 ms | session context |
| Page data queries | 50–100 ms each | already `Promise.all` where parallelisable |

So a page paid roughly **370 ms before doing any of its own work**, and two of those four
calls were the same auth check performed twice in two runtimes that cannot share a cache.

Of that 370 ms, **~28 ms was recovered** (see the deployed measurement below). The
remainder is still there: middleware keeps `getUser()` (it cannot use local verification —
see "Deliberately not applied to middleware"), and the two `profiles` reads are
deliberately not cached because `access_state` must be current on every request.

## 3. What was changed

### Local JWT verification in the session layer

The project signs access tokens with **ES256** asymmetric keys
(`/config/auth/signing-keys` reports `ES256` `in_use`), so the signature can be verified
locally against the cached JWKS instead of asking GoTrue who the caller is.

Isolated measurement, warm process:

| | Median |
| --- | --- |
| `getUser()` — network to GoTrue | 63 ms |
| `getClaims()` — local WebCrypto verify | **0 ms** |

Applied in `getSessionContext` (`src/lib/supabase/verified-caller.ts`). This is safe because identity and authorization are
separate here: the profile row is still read on every request, so `access_state` still
takes effect immediately, and a deleted account loses all data access because
`get_clinic_id()` resolves through `profiles` and returns NULL. RLS does the authorizing,
not the token.

#### What it actually saves in production

The 63 ms is **not** what a user gets, and measuring it in a warm process overstates the
win. Vercel invocations are short-lived, so the JWKS is fetched (from Supabase's
edge-cached discovery endpoint) more often than a long-running benchmark suggests.

Measured on the real deployment, same session cookie, same page, alternating requests,
9 samples per side, three rounds of the whole comparison:

| Round | Before (`jshrj0hcz`) | After (`1zt404dm0`) | Saved |
| --- | --- | --- | --- |
| 1 | 241 ms | 208 ms | 33 ms (14%) |
| 2 | 229 ms | 213 ms | 16 ms (7%) |
| 3 | 215 ms | 187 ms | 28 ms (13%) |

**Realistic figure: ~28 ms per authenticated page load, 7–14%.** Comments in the source
say ~63 ms because that is the cost of the call that was removed; the page-level number is
lower because the dashboard's own data reads dominate and `getSessionContext` is
React-cached to one call per request.

Reproduce with `node scripts/bench-deployed-pages.cjs <cookie> <oldBase> <newBase> /dashboard`.
The comparison must use two `*.vercel.app` URLs: hitting the custom domain against a
`*.vercel.app` deployment gave a *negative* result (−15 ms) purely from the different
routing path, which is what a careless before/after would have reported.

### Deliberately not applied to middleware

`getClaims()` in **edge middleware** failed every request with
`MIDDLEWARE_INVOCATION_FAILED` on this project — including unauthenticated requests to
`/login`, which makes the login page unreachable and the site unrecoverable without a
redeploy. It works in the Node runtime (verified locally and in production). Middleware is
the one place that must not fail closed for anonymous visitors, so it keeps `getUser()`.
The ~63 ms it costs is accepted and documented in `middleware.ts`.

## 4. A production-relevant bug found while testing

`NEXT_PUBLIC_SUPABASE_URL` existed **only for the `production` target**. `NEXT_PUBLIC_*`
values are inlined at build time, so every **preview** deployment was built with
`undefined` for the Supabase URL. `createServerClient(undefined, …)` throws inside
middleware, so every preview URL returned `MIDDLEWARE_INVOCATION_FAILED` on every path.

This is why preview builds could not be reviewed before merging — and it was invisible
from the outside, because production was unaffected. Fixed by targeting `preview` too.
`scripts/test-middleware-session-paths.cjs` now checks `/login`, a protected page, an API
route and a garbage session cookie, and is the regression test for this class of failure.

## 5. Recommendations, in value order

1. **Caching — yes, but not of tenant data by default.** The safest wins are repeated
   identical work, not different users' rows:
   - Sarvam contract calls change almost never; cache the JWKS/discovery-style reads and
     rely on the SDK's built-in caching rather than adding one.
   - `clinic_scheduler_settings` and `appointment_types` are read on most Scheduler
     requests and change rarely. A short-lived per-clinic cache is the obvious first
     target, invalidated on write (the RPCs already exist and are the only writers).
   - Do **not** add `unstable_cache` around anything selected with the service-role
     client: the cache key would have to carry the clinic, and a missed key is a
     cross-tenant leak. React `cache` (per-request) is free and already used.
2. **Collapse the double auth check.** Middleware and the page each resolve the same
   session. Middleware could pass the verified identity to the page as a request header it
   overwrites (so the client cannot forge it), letting the page skip its own token check.
   Worth ~60 ms per navigation; needs care because a header-based shortcut is exactly the
   kind of thing that silently becomes trusted from the wrong direction.
3. **Parallelise the remaining page reads.** Several pages still `await` independent
   queries one after another. Cheap, mechanical, no risk.
4. **Recheck transcription cost, not latency.** The durable queue already retries safely,
   but a retried upload can still be billed twice at the provider. Idempotency by audio
   content hash is a cost control, not a speed one.

## 6. What not to do

- Do not remove the middleware `access_state` check to save 104 ms. It is the only thing
  that stops a suspended account mid-session, and suspension must not wait for a token to
  expire.
- Do not cache a `profiles` read across requests. Suspension and role changes have to be
  visible on the next request.
