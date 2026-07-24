"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "google" | "error";

function LoginInner() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  // ?error=not-allowed — derived, not state+effect. useSearchParams needs a
  // Suspense boundary at build time; the default export below provides it.
  const rejected = useSearchParams().get("error") === "not-allowed";
  // This repo is CardOps, so brand as CardOps from the first paint. It used to
  // default to "MasterOps" and swap post-mount by hostname, back when one login
  // page served both apps out of the monorepo — which meant a visible flash of
  // the wrong product name before hydration (and it's what Vercel's deployment
  // thumbnail captures). (2026-07-24)
  const appName = "CardOps";

  async function handleGoogle() {
    setStatus("google");
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Always show Google's account chooser — without this, Google silently
        // reuses the one remembered account and you can never switch.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    }
    // On success the browser navigates away to Google.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Don't let an unknown email self-provision an account — the DB
        // is_operator() gate is the real boundary, this is defense in depth.
        shouldCreateUser: false,
      },
    });

    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-r from-[#8a6d1f] via-[#f6e6ac] to-[#c9a227] bg-clip-text text-3xl font-bold tracking-tight text-transparent">{appName}</h1>
          <p className="mt-1 text-sm text-ink/50">
            Sign in to continue
          </p>
        </div>

        {rejected && (
          <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-4 text-center">
            <p className="text-sm text-danger">
              That account isn&apos;t on the access list.
            </p>
          </div>
        )}

        {status === "sent" ? (
          <div className="rounded-xl border border-flag/40 bg-flag/10 p-5 text-center">
            <p className="text-sm text-flag">
              Check <span className="font-medium">{email}</span> for a sign-in
              link. You can close this tab once you click it.
            </p>
            <button
              onClick={() => setStatus("idle")}
              className="mt-4 text-xs text-ink/50 underline underline-offset-4 hover:text-ink"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <button
              onClick={handleGoogle}
              disabled={status === "google"}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-flag px-4 py-3 text-base font-semibold text-[#0b1712] shadow-lg shadow-flag/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.9-5.35 3.9a5.9 5.9 0 1 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.15-2.15A8.9 8.9 0 1 0 12 20.9c5.15 0 8.75-3.6 8.75-8.7 0-.4-.05-.75-.1-1.1Z"
                />
              </svg>
              {status === "google" ? "Redirecting…" : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3 text-xs text-ink/40">
              <div className="h-px flex-1 bg-hairline" />
              or magic link
              <div className="h-px flex-1 bg-hairline" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-white px-4 py-3 text-base text-ink placeholder-ink/40 outline-none focus:border-flag focus:ring-1 focus:ring-flag"
              />
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full rounded-lg border border-hairline bg-white px-4 py-3 text-base font-medium text-ink transition hover:border-flag disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Send magic link"}
              </button>
            </form>

            {status === "error" && (
              <p className="text-center text-sm text-danger">{error}</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
