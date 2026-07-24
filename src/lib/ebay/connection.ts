import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken } from "./crypto";
import { refreshAccess } from "./oauth";

// Get a live eBay access token for the connected seller, auto-refreshing when
// stale (access tokens last ~2h; the refresh token ~18 months). Returns null
// when not connected / key missing / refresh dead (UI shows "Reconnect").
//
// Every eBay route is owner-gated, so there is exactly one connection row today
// and .maybeSingle() is safe. It would stop being safe the moment members can
// connect eBay — hence getEbayConnection() below, which also hands back WHOSE
// connection it is so the cron can scope its writes to that seller's cards.
export async function getEbayAccess(supabase: SupabaseClient): Promise<string | null> {
  return (await getEbayConnection(supabase))?.access ?? null;
}

/** The live token plus the user it belongs to. */
export async function getEbayConnection(
  supabase: SupabaseClient,
): Promise<{ access: string; userId: string } | null> {
  const { data: row } = await supabase
    .from("ebay_connections")
    .select("user_id, access_token, refresh_token, token_expiry")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return null;
  const userId = row.user_id as string;

  const expiry = row.token_expiry ? new Date(row.token_expiry as string).getTime() : 0;
  if (expiry > Date.now() + 120_000) {
    const access = openToken(row.access_token as string | null);
    if (access) return { access, userId };
  }

  const refresh = openToken(row.refresh_token as string | null);
  if (!refresh) return null;
  try {
    const t = await refreshAccess(refresh);
    const sealed = sealToken(t.access_token);
    if (sealed) {
      await supabase
        .from("ebay_connections")
        .update({
          access_token: sealed,
          token_expiry: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }
    return { access: t.access_token, userId };
  } catch {
    return null;
  }
}
