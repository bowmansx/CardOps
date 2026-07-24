import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { authorizeUrl, ebayConfigured } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

// Kick off the eBay seller-consent flow (owner only — this connects BEAU's
// seller account). Single-homed on the MasterOps domain: the registered
// RuName redirect points at THIS domain's /api/ebay/callback.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if ((await currentRole()) !== "owner") {
    return NextResponse.redirect(new URL("/cards", request.url));
  }
  if (!ebayConfigured()) {
    return NextResponse.redirect(new URL("/cards/services?ebay=not-configured", request.url));
  }

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  // CSRF state: verified by the callback. Lax so it survives eBay's redirect.
  res.cookies.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
