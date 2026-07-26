"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { catCode } from "@/lib/cards/sku";
import { nextSku } from "@/lib/cards/skudb";

const CARD_ENTITY = "bfa6ad79-0d3a-412b-a682-603aa9d23f1d";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authed(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/** Validate a requested owning-business, falling back to the default CARD entity.
 *  Entities are owner-gated by RLS, so a non-owner's request simply can't resolve
 *  and safely defaults — no way to attribute a card to a business you can't see. */
async function resolveEntityId(supabase: SupabaseClient, requested?: string): Promise<string> {
  const req = (requested ?? "").trim();
  if (req && UUID.test(req)) {
    const { data } = await supabase.from("card_businesses").select("id").eq("id", req).maybeSingle();
    if (data) return req;
  }
  return CARD_ENTITY;
}

/** Owner-only businesses for the intake picker; [] for anyone else (RLS). */
export async function listEntityOptions(): Promise<{ id: string; short_code: string; name: string }[]> {
  try {
    const { supabase } = await authed();
    const { data } = await supabase.from("card_businesses").select("id, short_code, name").eq("active", true).order("short_code");
    return (data ?? []).map((e) => ({ id: e.id as string, short_code: e.short_code as string, name: e.name as string }));
  } catch {
    return [];
  }
}

/**
 * Store ONE image and return its card_photos id.
 *
 * `bytes` is always recorded — storage is a metered resource and you cannot
 * bill, cap or warn on what was never measured (DESIGN_PHOTO_SYSTEM §6).
 * Failures are RETURNED, not swallowed: this used to `return` silently on an
 * upload error, so a card could end up with no photo and nobody the wiser
 * (prevention rule 1).
 */
async function putImage(
  supabase: SupabaseClient,
  cardId: string,
  kind: string,
  dataUrl: string,
  opts: { variant: "original" | "processed"; derivedFrom?: string | null; cropGeometry?: unknown; captureMeta?: unknown },
): Promise<{ id: string | null; error: string | null }> {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return { id: null, error: "unrecognised image data" };
  const ext = m[1].split("/")[1].replace("jpeg", "jpg");
  const buf = Buffer.from(m[2], "base64");
  // Folder by user first so the storage bucket itself is per-tenant (the RLS
  // policy also still honours the legacy <card_id>/… layout for older photos).
  const { data: { user } } = await supabase.auth.getUser();
  const suffix = opts.variant === "original" ? "-src" : "";
  const path = user
    ? `${user.id}/${cardId}/${kind}${suffix}-${Date.now()}.${ext}`
    : `${cardId}/${kind}${suffix}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("card-photos")
    .upload(path, buf, { contentType: m[1], upsert: false });
  if (upErr) return { id: null, error: upErr.message };

  const { data, error: rowErr } = await supabase
    .from("card_photos")
    .insert({
      card_id: cardId, kind, role: kind, variant: opts.variant,
      bucket: "card-photos", path, bytes: buf.byteLength,
      derived_from: opts.derivedFrom ?? null,
      crop_geometry: opts.cropGeometry ?? null,
      capture_meta: opts.captureMeta ?? null,
    })
    .select("id")
    .maybeSingle();
  if (rowErr) return { id: null, error: rowErr.message };
  return { id: (data?.id as string) ?? null, error: null };
}

/**
 * Store a shot: the uncropped frame first (when the camera kept one), then the
 * framed image linked back to it.
 *
 * ORDER MATTERS. The original goes first so the derivative can point at it —
 * a crop whose source is unknown is exactly the situation the margin rule
 * exists to prevent.
 */
async function uploadPhoto(
  supabase: SupabaseClient,
  cardId: string,
  kind: "front" | "back",
  dataUrl: string | undefined,
  originalUrl?: string | undefined,
): Promise<string | null> {
  if (!dataUrl) return null;
  let originalId: string | null = null;
  if (originalUrl) {
    const src = await putImage(supabase, cardId, kind, originalUrl, { variant: "original" });
    if (src.error) console.error(`[intake] ${kind} uncropped frame not stored: ${src.error}`);
    originalId = src.id;
  }
  const framed = await putImage(supabase, cardId, kind, dataUrl, {
    variant: originalId ? "processed" : "original",
    derivedFrom: originalId,
    cropGeometry: originalId ? { margin_pct: 0.04, deskewed: false } : null,
  });
  if (framed.error) return `${kind} photo not saved: ${framed.error}`;
  return null;
}

export type IntakeInput = {
  player?: string; year?: string; set_name?: string; card_number?: string;
  parallel?: string; sport_category?: string; team?: string; rarity?: string; brand?: string;
  is_rookie?: boolean; is_auto?: boolean; is_relic?: boolean; serial_number?: string;
  condition_type?: string; raw_grade_estimate?: string;
  grader?: string; grade?: string; cert_number?: string;
  zone?: string; location_code?: string; pricing_strategy?: string;
  entity_id?: string; tax_treatment?: string;
  cost?: string; // OPTIONAL: acquisition cost. Blank = not stated (basis_entered false).
  vision_confidence?: unknown;
  front?: string; back?: string;
  // The uncropped camera frames behind `front`/`back`, when the in-app camera
  // took them. Stored as variant='original' with the framed shot linked to it.
  front_original?: string; back_original?: string;
};

const TREATMENTS = ["dealer", "investment", "hobby"];
const treatmentOf = (t?: string) => (t && TREATMENTS.includes(t) ? t : "dealer");


export type UploadedPhotoRef = {
  path: string; bytes: number; kind: string;
  variant: "original" | "processed";
  shotIndex: number;
  derivedFromIndex?: number;
  cropGeometry?: unknown; captureMeta?: unknown;
};

/**
 * Record photos the BROWSER already uploaded to storage.
 *
 * The bytes never touch this action — only paths — so the server-action body
 * limit stops being a ceiling on photo quality.
 *
 * Nothing here is taken on trust. The card is re-read under the caller's RLS;
 * every path must sit inside that user's own folder; and each object's SIZE is
 * read back from storage rather than believed, because `bytes` feeds the
 * storage meter and a number the client simply asserts is not a measurement
 * (prevention rule 9 — money and metered figures are validated, never
 * defaulted).
 */
export async function recordCardPhotos(
  cardId: string,
  photos: UploadedPhotoRef[],
): Promise<{ ok: boolean; recorded?: number; error?: string; warning?: string }> {
  try {
    const { supabase, userId } = await authed();
    if (!photos.length) return { ok: true, recorded: 0 };

    // RLS-scoped read: a card you can't see doesn't exist to you.
    const { data: card, error: cardErr } = await supabase
      .from("cards").select("id").eq("id", cardId).maybeSingle();
    if (cardErr) return { ok: false, error: cardErr.message };
    if (!card) return { ok: false, error: "That card isn't yours." };

    const prefix = `${userId}/${cardId}/`;
    const bad = photos.find((p) => typeof p.path !== "string" || !p.path.startsWith(prefix) || p.path.includes(".."));
    if (bad) return { ok: false, error: "A photo path was outside this card's own storage." };

    // Verify each object EXISTS and take its real size from storage.
    const { data: listed, error: listErr } = await supabase.storage
      .from("card-photos").list(`${userId}/${cardId}`, { limit: 1000 });
    if (listErr) return { ok: false, error: `Couldn't verify the uploads: ${listErr.message}` };
    const sizeByName = new Map<string, number>();
    for (const o of listed ?? []) {
      const meta = o.metadata as { size?: number } | null;
      sizeByName.set(o.name, Number(meta?.size ?? 0));
    }

    // Originals first, so a crop can point at the frame it came from — a crop
    // whose source is unknown is what the margin rule exists to prevent.
    const order = [...photos.keys()].sort(
      (a, b) => (photos[a].variant === "original" ? 0 : 1) - (photos[b].variant === "original" ? 0 : 1),
    );
    const idByShotIndex = new Map<number, string>();
    const failures: string[] = [];

    for (const i of order) {
      const p = photos[i];
      const name = p.path.slice(prefix.length);
      if (!sizeByName.has(name)) { failures.push(`${p.kind}: the uploaded file isn't in storage`); continue; }
      const derivedFrom = p.derivedFromIndex != null ? idByShotIndex.get(p.derivedFromIndex) ?? null : null;
      // A crop whose original failed to record loses its link. Say so in the
      // row rather than letting it look like a photo that was never cropped.
      const geom = p.derivedFromIndex != null && !derivedFrom
        ? { ...(p.cropGeometry as Record<string, unknown> ?? {}), original_link_lost: true }
        : p.cropGeometry ?? null;
      const { data, error } = await supabase
        .from("card_photos")
        .insert({
          card_id: cardId, kind: p.kind, role: p.kind, variant: p.variant,
          bucket: "card-photos", path: p.path,
          bytes: sizeByName.get(name) ?? 0,
          derived_from: derivedFrom,
          crop_geometry: geom,
          capture_meta: p.captureMeta ?? null,
        })
        .select("id")
        .single();
      // Checked, never assumed: an unrecorded photo is an uploaded object that
      // no screen will ever show and no quota will ever count (rules 1 and 7).
      if (error) { failures.push(`${p.kind}: ${error.message}`); continue; }
      idByShotIndex.set(p.shotIndex, data.id as string);
    }

    revalidatePath(`/cards/${cardId}`);
    if (failures.length) {
      return {
        ok: true, recorded: idByShotIndex.size,
        warning: `${failures.length} photo${failures.length === 1 ? "" : "s"} uploaded but couldn't be recorded — ${failures.join(" · ")}`,
      };
    }
    return { ok: true, recorded: idByShotIndex.size };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't record the photos." };
  }
}

// Full Intake: human-reviewed card → insert + store photos.
export async function commitIntakeCard(
  input: IntakeInput,
): Promise<{ ok: boolean; id?: string; sku?: string; error?: string; warning?: string }> {
  // A server action that THROWS rejects the client's promise instead of
  // returning — the caller gets no result to inspect, which is how a save
  // failure turned into a spinner that never stopped. Every failure in here
  // comes back as a value the screen can render.
  try {
    return await commitIntakeCardInner(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The save failed." };
  }
}

async function commitIntakeCardInner(
  input: IntakeInput,
): Promise<{ ok: boolean; id?: string; sku?: string; error?: string; warning?: string }> {
  const { supabase } = await authed();
  // Cost is OPTIONAL and defaults to 0 (Beau, 2026-07-25) — scanning a card
  // should never stop because you haven't looked up what you paid. A figure you
  // DID state is marked as stated, so an unpriced card can be found and filled
  // in later instead of quietly reading as free.
  const stated = input.cost != null && String(input.cost).trim() !== "";
  const cost = stated ? Number(input.cost) : 0;
  if (stated && (!Number.isFinite(cost) || cost < 0)) {
    return { ok: false, error: "That cost doesn't look like a number." };
  }
  const category = input.sport_category?.trim() || null;
  const year = input.year && Number.isFinite(Number(input.year)) ? Number(input.year) : new Date().getFullYear();
  const cat = catCode(category);
  const row = {
    player: input.player?.trim() || null,
    year: input.year && Number.isFinite(Number(input.year)) ? Number(input.year) : null,
    set_name: input.set_name?.trim() || null,
    card_number: input.card_number?.trim() || null,
    parallel: input.parallel?.trim() || null,
    sport_category: category,
    team: input.team?.trim() || null,
    rarity: input.rarity?.trim() || null,
    brand: input.brand?.trim() || null,
    is_rookie: !!input.is_rookie,
    is_auto: !!input.is_auto,
    is_relic: !!input.is_relic,
    serial_number: input.serial_number?.trim() || null,
    condition_type: input.condition_type === "graded" ? "graded" : "raw",
    raw_grade_estimate: input.raw_grade_estimate?.trim() || null,
    grader: input.grader?.trim() || null,
    grade: input.grade && Number.isFinite(Number(input.grade)) ? Number(input.grade) : null,
    cert_number: input.cert_number?.trim() || null,
    zone: input.zone?.trim() || null,
    location_code: input.location_code?.trim() || null,
    pricing_strategy: input.pricing_strategy?.trim() || "standard",
    vision_confidence: input.vision_confidence ?? null,
    individual_basis: cost,
    basis_entered: stated,
    status: "booked",
    entity_id: await resolveEntityId(supabase, input.entity_id),
    // Tax treatment is an owner decision (drives the owner-only books); staff default to dealer.
    tax_treatment: (await currentRole()) === "owner" ? treatmentOf(input.tax_treatment) : "dealer",
  } as Record<string, unknown>;
  let id: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const sku = await nextSku(supabase, cat, year);
    const { data, error } = await supabase.from("cards").insert({ ...row, sku }).select("id").single();
    if (!error) { id = data.id as string; break; }
    // Pre-migration fallback: new columns not applied yet — strip and retry.
    if (/rarity|brand|tax_treatment/.test(error.message)) { delete row.rarity; delete row.brand; delete row.tax_treatment; continue; }
    if (error.code !== "23505" || attempt === 4) return { ok: false, error: error.message };
  }
  if (!id) return { ok: false, error: "Could not create the card." };
  // A photo that failed to save is worth telling the user about — the card
  // exists either way, but silently losing the image is how you discover at
  // listing time that there's nothing to show (rules 1 and 8).
  const photoWarnings = [
    await uploadPhoto(supabase, id, "front", input.front, input.front_original),
    await uploadPhoto(supabase, id, "back", input.back, input.back_original),
  ].filter(Boolean) as string[];
  revalidatePath("/cards");
  return { ok: true, id, ...(photoWarnings.length ? { warning: photoWarnings.join(" · ") } : {}) };
}

// Batch (AI) mode: stamp the chosen pricing standard + storage place onto a
// whole batch at once (Speed Book's RPC books with defaults; this applies the
// picked ones after).
export async function applyBatchStrategy(
  ids: string[],
  strategy: string,
  storageLocation?: string,
  entityId?: string,
  treatment?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await authed();
  if (!ids.length) return { ok: true };
  const row: Record<string, unknown> = { pricing_strategy: strategy || "standard" };
  const loc = storageLocation?.trim();
  if (loc) row.storage_location = loc;
  // Attribute the batch to the chosen business (validated; defaults to CARD).
  if (entityId) row.entity_id = await resolveEntityId(supabase, entityId);
  if (treatment && TREATMENTS.includes(treatment) && (await currentRole()) === "owner") row.tax_treatment = treatment;
  let { error } = await supabase.from("cards").update(row).in("id", ids);
  if (error && /storage_location|tax_treatment/.test(error.message)) {
    // Pre-migration fallback: a new column not applied yet — strip and retry.
    delete row.storage_location;
    delete row.tax_treatment;
    ({ error } = await supabase.from("cards").update(row).in("id", ids));
  }
  if (loc) {
    try {
      await supabase.from("card_storage_locations").upsert({ name: loc }, { onConflict: "user_id,name" });
    } catch {}
  }
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Storage pick-list for the batch defaults; [] before the migration is pasted.
export async function listStorageNames(): Promise<string[]> {
  try {
    const { supabase } = await authed();
    const { data } = await supabase.from("card_storage_locations").select("name").order("name");
    return (data ?? []).map((r) => r.name as string);
  } catch {
    return [];
  }
}

// Batch (AI) mode: apply a vision scan's identity fields to an already-booked
// card and park it in `review` so the batch collects into one edit pile.
// Fresh quick-booked cards only — fills fields, never a destructive rewrite.
export async function applyBatchScan(
  id: string,
  input: IntakeInput,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await authed();
  const row: Record<string, unknown> = {
    player: input.player?.trim() || null,
    year: input.year && Number.isFinite(Number(input.year)) ? Number(input.year) : null,
    set_name: input.set_name?.trim() || null,
    card_number: input.card_number?.trim() || null,
    parallel: input.parallel?.trim() || null,
    team: input.team?.trim() || null,
    is_rookie: !!input.is_rookie,
    is_auto: !!input.is_auto,
    is_relic: !!input.is_relic,
    serial_number: input.serial_number?.trim() || null,
    condition_type: input.condition_type === "graded" ? "graded" : "raw",
    raw_grade_estimate: input.raw_grade_estimate?.trim() || null,
    grader: input.grader?.trim() || null,
    grade: input.grade && Number.isFinite(Number(input.grade)) ? Number(input.grade) : null,
    cert_number: input.cert_number?.trim() || null,
    vision_confidence: input.vision_confidence ?? null,
    status: "review",
  };
  // The batch default category stands unless the scan actually read one.
  if (input.sport_category?.trim()) row.sport_category = input.sport_category.trim();
  if (input.rarity?.trim()) row.rarity = input.rarity.trim();
  if (input.brand?.trim()) row.brand = input.brand.trim();
  let { error } = await supabase.from("cards").update(row).eq("id", id);
  if (error && /rarity|brand/.test(error.message)) {
    // Pre-migration fallback: new columns not applied yet.
    delete row.rarity;
    delete row.brand;
    ({ error } = await supabase.from("cards").update(row).eq("id", id));
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/cards");
  return { ok: true };
}

export type SpeedItem = {
  front?: string;
  /** The uncropped camera frame behind `front`, when the scanner kept one. */
  front_original?: string;
  sport_category?: string;
  zone?: string;
};

// Speed Book: rapid front-only batch. GUARDRAIL — a lot cost is REQUIRED so the
// pool average never gets deflated by $0-basis cards. The pool ledger is written
// service-role (RLS: pool writes are service-role only) and is append-only.
export async function commitSpeedBatch(
  items: SpeedItem[],
  lotCost: number,
): Promise<{ ok: boolean; inserted?: number; poolTotal?: number; ids?: string[]; error?: string; warning?: string }> {
  const { supabase } = await authed();
  if (!items.length) return { ok: false, error: "No cards in the batch." };
  // The RPC itself allows 0 ("0 allowed for a free lot"); the UI was stricter
  // than the rule it was enforcing.
  if (!Number.isFinite(lotCost) || lotCost < 0) {
    return { ok: false, error: "Enter the lot cost for this batch (0 is fine for a free lot)." };
  }

  // Atomic: the RPC inserts every card + writes the append-only pool ledger +
  // increments the pool inside ONE locked transaction. Either the whole lot
  // and its pool cost land together, or nothing does — no orphan pool-basis
  // cards, no lost pool updates. Photos are attached afterward (best-effort).
  // Only the identity fields go to the RPC — a batch's photos are uploaded by
  // the browser straight to storage and recorded afterwards by path, so a
  // 40-card stack is no larger on the wire than a 1-card one.
  const payload = items.map((it) => ({
    cat: catCode(it.sport_category?.trim() || null),
    sport_category: it.sport_category?.trim() || "",
    zone: it.zone?.trim() || "BULK",
  }));
  const { data, error } = await supabase.rpc("speed_book_commit", {
    p_items: payload,
    p_lot_cost: lotCost,
  });
  if (error) return { ok: false, error: error.message };
  // The RPC returns lot_cost, not pool_total — reading the wrong key meant
  // poolTotal was ALWAYS undefined and the confirmation screen showed nothing.
  const result = data as { inserted: number; ids: string[]; lot_id: string; lot_cost: number };

  // Legacy path: an item that still arrives carrying base64 (an older client,
  // or a caller that hasn't moved to direct upload) is still stored, so this
  // change can't strand a photo mid-rollout.
  const photoWarnings: string[] = [];
  for (let i = 0; i < result.ids.length; i++) {
    if (!items[i]?.front) continue;
    const w = await uploadPhoto(supabase, result.ids[i], "front", items[i]?.front, items[i]?.front_original);
    if (w) photoWarnings.push(`card ${i + 1}: ${w}`);
  }

  revalidatePath("/cards");
  // ids in insertion order (matches `items`) — Batch (AI) mode uses them to
  // stamp the chosen strategy and pair each card with its photo for scanning.
  return {
    ok: true, inserted: result.inserted, poolTotal: result.lot_cost, ids: result.ids,
    ...(photoWarnings.length ? { warning: `${photoWarnings.length} photo(s) not saved: ${photoWarnings.slice(0, 3).join(" · ")}` } : {}),
  };
}
