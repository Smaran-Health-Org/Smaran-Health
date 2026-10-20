import { NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { getSessionContext } from "@/lib/db/session";
import { forbidden, unauthorized } from "@/lib/api/error-handler";
import { logEvent } from "@/lib/logger";

/**
 * TEMPORARY egress diagnostic — remove once the ~4 s per-request penalty has
 * been found and fixed.
 *
 * Production logs show every outbound HTTPS call to `api.sarvam.ai` and to
 * Supabase taking ~4.2 s, while the same endpoints answer in 90–350 ms from a
 * developer machine, and a presigned Azure PUT from the same function takes
 * 170 ms. A constant per-request penalty that hits some hosts and not others is
 * either a broken address family, a slow resolver, or an intermediary adding
 * delay — and those are distinguishable only by timing each stage separately.
 *
 * Doctor-only so it is not a public attack surface. It returns timings and host
 * names only: no PHI, no credentials, no request bodies.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FetchResult = { url: string; ms: number; status?: number; server?: string | null; cfRay?: string | null; error?: string };

function timeConnect(host: string, family: 4 | 6): Promise<number | string> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port: 443, family });
    const done = (value: number | string) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(6000);
    socket.once("connect", () => done(Date.now() - started));
    socket.once("timeout", () => done("timeout"));
    socket.once("error", (error: NodeJS.ErrnoException) => done(`error:${error.code ?? error.message}`));
  });
}

function timeTls(address: string, servername: string): Promise<number | string> {
  return new Promise((resolve) => {
    const started = Date.now();
    // Connect by literal address so the family is fixed; SNI still carries the
    // host name so certificate validation behaves normally.
    const socket = tls.connect({ host: address, port: 443, servername });
    const done = (value: number | string) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(6000);
    socket.once("secureConnect", () => done(Date.now() - started));
    socket.once("timeout", () => done("timeout"));
    socket.once("error", (error: NodeJS.ErrnoException) => done(`error:${error.code ?? error.message}`));
  });
}

async function timeFetch(url: string): Promise<FetchResult> {
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store" });
    await response.arrayBuffer();
    return {
      url,
      ms: Date.now() - started,
      status: response.status,
      server: response.headers.get("server"),
      cfRay: response.headers.get("cf-ray"),
    };
  } catch (error) {
    return {
      url,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeHost(url: string) {
  const host = new URL(url).hostname;
  const lookupStarted = Date.now();
  let addresses: string[] = [];
  let lookupError: string | null = null;
  try {
    addresses = (await dns.lookup(host, { all: true })).map((entry) => `${entry.address}/${entry.family}`);
  } catch (error) {
    lookupError = error instanceof Error ? error.message : String(error);
  }
  const lookupMs = Date.now() - lookupStarted;

  const ipv4 = addresses.find((address) => address.endsWith("/4"))?.split("/")[0] ?? host;
  const ipv6 = addresses.find((address) => address.endsWith("/6"))?.split("/")[0] ?? host;

  const [cold, warm] = [await timeFetch(url), await timeFetch(url)];

  return {
    host,
    addresses,
    lookupMs,
    lookupError,
    tcp4Ms: await timeConnect(ipv4, 4),
    tcp6Ms: addresses.some((address) => address.endsWith("/6")) ? await timeConnect(ipv6, 6) : "no-aaaa",
    tls4Ms: await timeTls(ipv4, host),
    cold,
    warm,
  };
}

export async function GET() {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Doctor access only");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const targets = [
    "https://api.sarvam.ai/speech-to-text/job/v1",
    `${supabaseUrl}/auth/v1/health`,
    `${supabaseUrl}/storage/v1/version`,
    "https://example.com/",
  ].filter((url) => url.startsWith("https://"));

  const before = [];
  for (const target of targets) before.push(await probeHost(target));

  // If the sandbox has no working IPv6 route but Node still prefers AAAA, every
  // first connection pays the kernel's SYN retry penalty. Re-ordering the DNS
  // result is the one-line fix, so measure it rather than assume it.
  dns.setDefaultResultOrder("ipv4first");
  const after = [];
  for (const target of targets) after.push(await probeHost(target));

  const report = {
    node: process.version,
    platform: process.platform,
    autoSelectFamily:
      typeof net.getDefaultAutoSelectFamily === "function" ? net.getDefaultAutoSelectFamily() : "unknown",
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    before,
    afterIpv4First: after,
  };
  logEvent("diag.egress", report);
  return NextResponse.json(report);
}
