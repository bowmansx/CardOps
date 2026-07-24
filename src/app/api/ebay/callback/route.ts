import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { exchangeCode } from "@/lib/ebay/oauth";
import { sealToken } from "@/lib/ebay/crypto";

export const dynamic = "force-dynamic";

// Completes the eBay consent flow: verifies the CSRF state, exchanges the
// code, and stores the token set ENCRYPTED (AES-GCM) under owner-only RLS.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/cards/services?ebay=error&msg=${encodeURIComponent(msg)}`, request.url));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if ((await currentRole()) !== "owner") return NextResponse.redirect(new URL("/cards", request.url));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/ebay_oauth_state=([a-f0-9]+)/)?.[1];
  if (!code) return fail(url.searchParams.get("error_description") ?? "eBay declined the connection.");
  if (!state || !cookieState || state !== cookieState) return fail("State mismatch — start the connect again.");

  try {
    const tokens = await exchangeCode(code);
    const sealedRefresh = tokens.refresh_token ? sealToken(tokens.refresh_token) : null;
    const sealedAccess = sealToken(tokens.access_token);
    if (!sealedAccess || (tokens.refresh_token && !sealedRefresh)) {
      return fail("EBAY_TOKEN_KEY missing/invalid — tokens were NOT stored.");
    }
    const { error } = await supabase.from("ebay_connections").upsert({
      user_id: user.id,
      access_token: sealedAccess,
      refresh_token: sealedRefresh,
      token_expiry: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
      scopes: "sell.inventory sell.account sell.fulfillment",
      updated_at: new Date().toISOString(),
    });
    if (error) return fail(error.message);

    const res = NextResponse.redirect(new URL("/cards/services?ebay=connected", request.url));
    res.cookies.set("ebay_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Token exchange failed.");
  }
}
