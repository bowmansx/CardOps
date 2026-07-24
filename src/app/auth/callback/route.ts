import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes magic-link sign-in: exchanges the one-time code in the URL
 * for a session, then redirects into the app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-origin absolute paths — rejects //evil.com, /\evil.com etc.
  // (open-redirect hardening; neither app currently sends `next`).
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/";

  // Behind a proxy (e.g. Vercel), trust the forwarded host/proto for the
  // public origin so we don't redirect to an internal host or http://.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const base = forwardedHost
    ? `${forwardedProto ?? "https"}://${forwardedHost}`
    : origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/login?error=auth-failed`);
}
