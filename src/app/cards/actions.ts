"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { catCode, buildSku } from "@/lib/cards/sku";

const CARD_ENTITY = "bfa6ad79-0d3a-412b-a682-603aa9d23f1d"; // CARD entity id

async function authed(): Promise<SupabaseClient> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return supabase;
}

function str(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

// Columns from paste-applied migrations that may not exist yet — the
// pre-migration fallback strips these and retries (todos-service pattern).
const NEW_COLS = /rarity|brand|storage_location/;
function stripNewCols(row: Record<string, unknown>) {
  delete row.rarity;
  delete row.brand;
  delete row.storage_location;
}

// Remember a storage place so it shows in every future pick-list.
// Best-effort: ignore errors (incl. table-not-yet-pasted).
async function rememberLocation(supabase: SupabaseClient, name: string | null) {
  if (!name) return;
  try {
    await supabase.from("card_storage_locations").upsert({ name }, { onConflict: "user_id,name" });
  } catch {}
}

// Storage pick-list for forms; [] before the migration is pasted.
export async function listStorageLocations(): Promise<string[]> {
  try {
    const supabase = await authed();
    const { data } = await supabase.from("card_storage_locations").select("name").order("name");
    return (data ?? []).map((r) => r.name as string);
  } catch {
    return [];
  }
}
function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v.toString().trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function nextSku(supabase: SupabaseClient, cat: string, year: number): Promise<string> {
  const prefix = `${cat}-${year}-`;
  const { data } = await supabase
    .from("cards")
    .select("sku")
    .like("sku", `${prefix}%`)
    .order("sku", { ascending: false })
    .limit(1);
  let seq = 1;
  if (data && data[0]) {
    const last = parseInt(String(data[0].sku).slice(prefix.length), 10);
    if (Number.isFinite(last)) seq = last + 1;
  }
  return buildSku(cat, year, seq);
}

function fields(formData: FormData) {
  return {
    player: str(formData.get("player")),
    year: num(formData.get("year")),
    set_name: str(formData.get("set_name")),
    card_number: str(formData.get("card_number")),
    parallel: str(formData.get("parallel")),
    sport_category: str(formData.get("sport_category")),
    team: str(formData.get("team")),
    rarity: str(formData.get("rarity")),
    language: str(formData.get("language")) ?? "EN",
    brand: str(formData.get("brand")),
    storage_location: str(formData.get("storage_location")),
    condition_type: str(formData.get("condition_type")) ?? "raw",
    grader: str(formData.get("grader")),
    grade: num(formData.get("grade")),
    cert_number: str(formData.get("cert_number")),
    // status is deliberately NOT read here: it is a transition, not a field.
    // Sales go through card_sell/card_unsell; archiving through archiveCard.
    zone: str(formData.get("zone")),
    location_code: str(formData.get("location_code")),
    market_value: num(formData.get("market_value")),
    manual_price: num(formData.get("manual_price")),
    pricing_strategy: str(formData.get("pricing_strategy")) ?? "standard",
    use_pool_basis: formData.get("use_pool_basis") != null,
    individual_basis: num(formData.get("individual_basis")),
    acquisition_method: str(formData.get("acquisition_method")),
    acquisition_source: str(formData.get("acquisition_source")),
    notes: str(formData.get("notes")),
  };
}

export async function createCard(formData: FormData) {
  const supabase = await authed();
  const f = fields(formData);
  const year = f.year ?? new Date().getFullYear();
  const cat = catCode(f.sport_category);
  // Retry on the rare SKU race (two concurrent creates read the same max seq
  // → duplicate-key 23505); recompute and re-insert. Pre-migration fallback:
  // if the rarity column isn't applied yet, strip it and continue (the
  // established todos-service pattern).
  let newId: string | null = null;
  const row: Record<string, unknown> = { ...f };
  for (let attempt = 0; attempt < 5; attempt++) {
    const sku = await nextSku(supabase, cat, year);
    const { data, error } = await supabase
      .from("cards")
      .insert({ ...row, sku, entity_id: CARD_ENTITY, status: "booked" })
      .select("id")
      .single();
    if (!error) { newId = data.id as string; break; }
    if (NEW_COLS.test(error.message)) { stripNewCols(row); continue; }
    if (error.code !== "23505" || attempt === 4) throw new Error(error.message);
  }
  await rememberLocation(supabase, f.storage_location);
  revalidatePath("/cards");
  redirect(`/cards/${newId}`);
}

export async function updateCard(id: string, formData: FormData) {
  const supabase = await authed();
  const f = fields(formData);
  let { error } = await supabase
    .from("cards")
    .update({ ...f, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error && NEW_COLS.test(error.message)) {
    // Pre-migration fallback: new columns not applied yet.
    const f2: Record<string, unknown> = { ...f };
    stripNewCols(f2);
    ({ error } = await supabase
      .from("cards")
      .update({ ...f2, updated_at: new Date().toISOString() })
      .eq("id", id));
  }
  if (error) throw new Error(error.message);
  await rememberLocation(supabase, f.storage_location);
  revalidatePath(`/cards/${id}`);
  revalidatePath("/cards");
  redirect(`/cards/${id}`);
}

// card_ops can never delete (guardrail #5) — archive via status instead.
export async function archiveCard(id: string) {
  const supabase = await authed();
  const { error } = await supabase
    .from("cards")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cards");
  redirect("/cards");
}

// Basic generic CSV import (generic_full columns). Rows already parsed client-side.
// CSV status handling: a row may say 'booked' or 'archived'. Anything else —
// especially 'sold' — imports as 'booked' and is counted in `coerced`: a sold
// card with no sale record is a lie the books would repeat, so the sale must
// be entered explicitly through the sell flow after import.
const IMPORTABLE_STATUSES = new Set(["booked", "archived"]);

export async function importCards(
  rows: Record<string, string>[],
): Promise<{ ok: boolean; inserted?: number; coerced?: number; error?: string }> {
  const supabase = await authed();
  const nowYear = new Date().getFullYear();
  let coerced = 0;
  // SKU year matches createCard (the card's own year, not the import date),
  // and the sequence namespace is keyed per (category, year).
  const out: Record<string, unknown>[] = [];
  const seqByKey: Record<string, number> = {};
  for (const r of rows) {
    const category = r.sport_category?.trim() || null;
    const cat = catCode(category);
    const y = r.year && Number.isFinite(Number(r.year)) ? Number(r.year) : nowYear;
    const key = `${cat}-${y}`;
    if (seqByKey[key] == null) {
      const prefix = `${key}-`;
      const { data } = await supabase
        .from("cards").select("sku").like("sku", `${prefix}%`)
        .order("sku", { ascending: false }).limit(1);
      let seq = 0;
      if (data?.[0]) {
        const last = parseInt(String(data[0].sku).slice(prefix.length), 10);
        if (Number.isFinite(last)) seq = last;
      }
      seqByKey[key] = seq;
    }
    seqByKey[key] += 1;
    out.push({
      sku: buildSku(cat, y, seqByKey[key]),
      entity_id: CARD_ENTITY,
      player: r.player?.trim() || null,
      year: r.year ? Number(r.year) || null : null,
      set_name: r.set_name?.trim() || null,
      card_number: r.card_number?.trim() || null,
      parallel: r.parallel?.trim() || null,
      sport_category: category,
      condition_type: r.condition_type?.trim() || "raw",
      grader: r.grader?.trim() || null,
      grade: r.grade ? Number(r.grade) || null : null,
      market_value: r.market_value ? Number(r.market_value) || null : null,
      status: (() => {
        const s = r.status?.trim() || "booked";
        if (IMPORTABLE_STATUSES.has(s)) return s;
        coerced += 1;
        return "booked";
      })(),
      zone: r.zone?.trim() || null,
      location_code: r.location_code?.trim() || null,
    });
  }
  if (out.length === 0) return { ok: false, error: "No rows to import." };
  const { error } = await supabase.from("cards").insert(out);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/cards");
  return { ok: true, inserted: out.length, coerced };
}
