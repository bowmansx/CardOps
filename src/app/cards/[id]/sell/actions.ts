"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SellResult =
  | { ok: true; net: number; basis: number; profit_loss: number }
  | { ok: false; error: string };

export async function sellCard(
  id: string,
  input: {
    platform: string;
    sale_price: number;
    fees: number;
    shipping_income: number;
    shipping_cost: number;
    order_ref: string | null;
    listing?: { title: string | null; description: string | null } | null;
  },
): Promise<SellResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Validate every money input (day-review: the RPC only checks sale_price;
  // a negative fee would inflate net proceeds and corrupt P/L).
  for (const [k, v] of Object.entries({
    sale_price: input.sale_price,
    fees: input.fees,
    shipping_income: input.shipping_income,
    shipping_cost: input.shipping_cost,
  })) {
    if (!Number.isFinite(v) || v < 0 || v > 10_000_000) {
      return { ok: false, error: `Invalid ${k.replace(/_/g, " ")}.` };
    }
  }

  const { data, error } = await supabase.rpc("card_sell", {
    p_card_id: id,
    p_platform: input.platform,
    p_sale_price: input.sale_price,
    p_fees: input.fees,
    p_ship_income: input.shipping_income,
    p_ship_cost: input.shipping_cost,
    p_order_ref: input.order_ref,
  });
  if (error) return { ok: false, error: error.message };

  // Best-effort: keep the platform listing details on the card (listing_refs
  // jsonb) for future reference / the eventual platform connectors.
  if (input.listing && (input.listing.title || input.listing.description)) {
    try {
      const { data: c } = await supabase.from("cards").select("listing_refs").eq("id", id).maybeSingle();
      // Non-object jsonb must not corrupt the merge (day-review).
      const prior = c?.listing_refs;
      const refs = prior && typeof prior === "object" && !Array.isArray(prior)
        ? (prior as Record<string, unknown>)
        : {};
      refs[input.platform] = { ...input.listing, at: new Date().toISOString() };
      await supabase.from("cards").update({ listing_refs: refs }).eq("id", id);
    } catch {}
  }

  revalidatePath("/cards");
  revalidatePath(`/cards/${id}`);
  const r = data as { net: number; basis: number; profit_loss: number };
  return { ok: true, net: r.net, basis: r.basis, profit_loss: r.profit_loss };
}
