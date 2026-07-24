import type { SupabaseClient } from "@supabase/supabase-js";
import { EBAY_HOSTS } from "./oauth";
import { categoryKind } from "@/lib/cards/types";

// Listing plumbing (connector plan §2 Phase 1.3-1.4, §3 mapping).

export async function ebayApi<T = unknown>(
  access: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const res = await fetch(`${EBAY_HOSTS.api}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      Accept: "application/json",
      ...(extraHeaders ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: T | null = null;
  try { data = text ? (JSON.parse(text) as T) : null; } catch { /* non-JSON */ }
  if (res.ok) return { ok: true, status: res.status, data, error: null };
  // Surface eBay's real complaint verbatim — that's how we iterate.
  const err =
    (data as { errors?: { message?: string; longMessage?: string }[] } | null)?.errors
      ?.map((e) => e.longMessage ?? e.message)
      .filter(Boolean)
      .join(" · ") || text.slice(0, 400) || `HTTP ${res.status}`;
  return { ok: false, status: res.status, data, error: err };
}

export const LOCATION_KEY = "cardops-main";

// eBay category routing per the plan §3.
export function ebayCategoryId(sportCategory: string | null): string {
  const kind = categoryKind(sportCategory);
  if (kind === "tcg") return "183454";      // CCG Individual Cards
  if (kind === "sport") return "261328";    // Sports Trading Card Singles
  return "183050";                          // Non-Sport Trading Cards
}

const GAME_NAMES: Record<string, string> = {
  Pokemon: "Pokémon TCG",
  MTG: "Magic: The Gathering",
  "LoL TCG": "Riftbound: League of Legends TCG",
};

type CardRow = Record<string, unknown>;

// Best-effort aspects from CardOps fields. eBay validates at publish; any
// missing required aspect comes back as a verbatim error we show the user.
export function buildAspects(card: CardRow): Record<string, string[]> {
  const kind = categoryKind(card.sport_category as string | null);
  const a: Record<string, string[]> = {};
  const put = (k: string, v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    if (s) a[k] = [s];
  };
  if (kind === "tcg") {
    put("Game", GAME_NAMES[card.sport_category as string] ?? (card.sport_category as string));
    put("Card Name", card.player);
    put("Set", card.set_name);
    put("Card Number", card.card_number);
    put("Language", card.language ?? "English");
    put("Finish", card.parallel);
    put("Rarity", card.rarity);
    put("Autographed", card.is_auto ? "Yes" : "No");
    put("Year Manufactured", card.year);
  } else {
    put("Sport", card.sport_category);
    put("Player/Athlete", card.player);
    put("Set", card.set_name);
    put("Year Manufactured", card.year);
    put("Season", card.year);
    put("Card Number", card.card_number);
    put("Team", card.team);
    put("Parallel/Variety", card.parallel);
    put("Language", card.language ?? "English");
    put("Manufacturer", card.brand);
    put("Autographed", card.is_auto ? "Yes" : "No");
    put("Card Serial Number", card.serial_number);
    if (card.print_run) put("Print Run", card.print_run);
    const features: string[] = [];
    if (card.is_rookie) features.push("Rookie");
    if (card.is_relic) features.push("Memorabilia");
    if (card.serial_number) features.push("Serial Numbered");
    if (features.length) a["Features"] = features;
  }
  return a;
}

// Condition per plan §3: raw = 4000, graded = 2750 (+descriptors; eBay may
// demand enum codes for the grader — its error will tell us).
export function buildCondition(card: CardRow): {
  condition: string;
  conditionDescriptors?: { name: string; values: string[] }[];
} {
  if (card.condition_type === "graded") {
    const d: { name: string; values: string[] }[] = [];
    if (card.grader) d.push({ name: "27501", values: [String(card.grader)] });
    if (card.grade != null) d.push({ name: "27502", values: [String(card.grade)] });
    if (card.cert_number) d.push({ name: "27503", values: [String(card.cert_number)] });
    return { condition: "LIKE_NEW", conditionDescriptors: d };
  }
  return { condition: "USED_VERY_GOOD" };
}

export type EbayPrefs = {
  location_ok?: boolean;
  ship_city?: string;
  ship_state?: string;
  ship_zip?: string;
  fulfillment_policy_id?: string;
  payment_policy_id?: string;
  return_policy_id?: string;
};

// Read/write the owner's eBay listing prefs inside user_settings.prefs.ebay.
export async function readEbayPrefs(supabase: SupabaseClient, userId: string): Promise<EbayPrefs> {
  const { data } = await supabase.from("user_settings").select("prefs").eq("user_id", userId).maybeSingle();
  const prefs = (data?.prefs as Record<string, unknown> | null) ?? {};
  return ((prefs.ebay as EbayPrefs) ?? {});
}

export async function writeEbayPrefs(supabase: SupabaseClient, userId: string, patch: EbayPrefs): Promise<void> {
  const { data } = await supabase.from("user_settings").select("prefs").eq("user_id", userId).maybeSingle();
  const prefs = (data?.prefs as Record<string, unknown> | null) ?? {};
  const merged = { ...prefs, ebay: { ...((prefs.ebay as EbayPrefs) ?? {}), ...patch } };
  await supabase.from("user_settings").upsert({ user_id: userId, prefs: merged }, { onConflict: "user_id" });
}

// First-of-each business policies from Seller Hub (cached in prefs).
export async function ensurePolicies(
  access: string,
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true; prefs: EbayPrefs } | { ok: false; error: string }> {
  const prefs = await readEbayPrefs(supabase, userId);
  if (prefs.fulfillment_policy_id && prefs.payment_policy_id && prefs.return_policy_id) {
    return { ok: true, prefs };
  }
  const grab = async (kind: string, listKey: string, idKey: string) => {
    const r = await ebayApi<Record<string, { [k: string]: unknown }[]>>(
      access, "GET", `/sell/account/v1/${kind}?marketplace_id=EBAY_US`,
    );
    if (!r.ok) throw new Error(`${kind}: ${r.error}`);
    const first = (r.data?.[listKey] ?? [])[0];
    const id = first?.[idKey] as string | undefined;
    if (!id) throw new Error(`No ${kind.replace(/_/g, " ")} found — create one in eBay Seller Hub → Business Policies.`);
    return id;
  };
  try {
    const [f, p, ret] = [
      await grab("fulfillment_policy", "fulfillmentPolicies", "fulfillmentPolicyId"),
      await grab("payment_policy", "paymentPolicies", "paymentPolicyId"),
      await grab("return_policy", "returnPolicies", "returnPolicyId"),
    ];
    const next: EbayPrefs = { ...prefs, fulfillment_policy_id: f, payment_policy_id: p, return_policy_id: ret };
    await writeEbayPrefs(supabase, userId, next);
    return { ok: true, prefs: next };
  } catch (e) {
    let msg = e instanceof Error ? e.message : "policy fetch failed";
    if (/not eligible for Business Polic/i.test(msg)) {
      // The exact wall Beau hit: the seller account isn't opted into
      // Business Policies yet — a one-time eBay account setting.
      msg =
        "Your eBay account isn't opted into Business Policies yet (one-time setup). " +
        "Go to ebay.com → Account Settings → Selling → Business Policies → Opt In " +
        "(eBay auto-creates shipping/payment/return policies from your past listings), then retry.";
    }
    return { ok: false, error: msg };
  }
}
