import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSku } from "./sku";

// Server-only: next sequential SKU for a category+year (read-max +1).
export async function nextSku(
  supabase: SupabaseClient,
  cat: string,
  year: number,
): Promise<string> {
  const prefix = `${cat}-${year}-`;
  const { data } = await supabase
    .from("cards")
    .select("sku")
    .like("sku", `${prefix}%`)
    .order("sku", { ascending: false })
    .limit(1);
  let seq = 1;
  if (data?.[0]) {
    const last = parseInt(String(data[0].sku).slice(prefix.length), 10);
    if (Number.isFinite(last)) seq = last + 1;
  }
  return buildSku(cat, year, seq);
}
