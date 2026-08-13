"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StethoscopeIcon } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 lg:flex lg:flex-col lg:justify-between p-12 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <StethoscopeIcon className="h-6 w-6" />
          </span>
          <span className="text-lg font-semibold">Smaran Health</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Clinical memory, without the paperwork.
          </h1>
          <p className="mt-4 text-teal-50/90">
            AI-assisted documentation and patient memory for specialist doctors —
            built for speed, safety, and privacy.
          </p>
        </div>

        <p className="text-sm text-teal-100/70">
          AI-generated drafts require doctor review and approval.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-slate-50 px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white">
              <StethoscopeIcon className="h-6 w-6" />
            </span>
            <span className="text-lg font-semibold text-slate-900">Smaran Health</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Access your clinic workspace.
          </p>

          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="doctor@clinic.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition-colors hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            For demo access, contact your clinic administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
