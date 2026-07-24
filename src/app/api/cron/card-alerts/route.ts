// CardOps alert engine (Beau, 2026-07-24). Split out of /api/cron/alerts, which
// had grown into a mixed job: MasterOps deadlines + the morning brief on one side,
// card price/%-move/movers on the other. Two products, two crons.
//
// The split also fixed a real multi-tenant defect. The old job ran as the SERVICE
// role — which bypasses RLS — read EVERY user's card_alerts and cards with no
// user filter, and pushed the results to the OWNER's devices only. So a member's
// watchlist hit notified Beau (naming a card that isn't his) and never notified
// the member. Everything here is per-user: a user's own alerts, own cards, own
// price history, own prefs, own devices.
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendToAll, pushConfigured, type StoredSubscription } from "@/lib/push";
import { pctChangeOverWindow, type PricePoint } from "@/lib/cards/movers";
import { buildMoversDigest } from "@/lib/cards/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;        // PostgREST caps a request at 1000 rows — always page.
const MAX_HISTORY = 60_000; // per user, so one huge inventory can't stall the run.

type CardMeta = {
  user_id?: string | null;
  player: string | null;
  year: number | null;
  set_name: string | null;
  market_value: number | null;
  manual_price: number | null;
};

/** Embedded to-one comes back as an object or a 1-element array depending on the shape. */
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function label(c: CardMeta | null): string {
  return [c?.year, c?.player, c?.set_name].filter(Boolean).join(" ") || "A watched card";
}

function priceOf(c: CardMeta | null): number | null {
  return (c?.manual_price ?? c?.market_value) as number | null;
}

/** Read every row, not the first 1000. Returns {rows, truncated}. */
async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap = Number.POSITIVE_INFINITY,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
    if (rows.length >= cap) return { rows, truncated: true };
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });
  if (!pushConfigured()) return NextResponse.json({ error: "VAPID keys missing." }, { status: 503 });

  const { data: people, error: peopleErr } = await svc
    .from("profiles").select("id").in("role", ["owner", "card_ops"]);
  if (peopleErr) return NextResponse.json({ error: peopleErr.message }, { status: 500 });

  const stale = new Set<string>();
  let priceHits = 0, pctHits = 0, digests = 0;
  const notes: string[] = [];

  for (const p of people ?? []) {
    const uid = p.id as string;
    const { data: subs } = await svc
      .from("push_subscriptions").select("endpoint, keys").eq("user_id", uid);
    const devices = (subs ?? []) as StoredSubscription[];
    if (!devices.length) continue; // nothing to notify — skip the work entirely

    priceHits += await targetAlerts(svc, uid, devices, stale, notes);
    pctHits += await pctAlerts(svc, uid, devices, stale, notes);
    digests += await moversDigest(svc, uid, devices, stale, notes);
  }

  if (stale.size) await svc.from("push_subscriptions").delete().in("endpoint", [...stale]);

  await svc.from("audit_log").insert({
    actor: "cron", action: "card_alerts_run", target: "card_alerts",
    payload: { users: (people ?? []).length, priceHits, pctHits, digests, pruned: stale.size, notes: notes.slice(0, 10) },
    result: "ok",
  });
  return NextResponse.json({ ok: true, users: (people ?? []).length, priceHits, pctHits, digests, notes: notes.slice(0, 10) });
}

// ── Target alerts: push when a watched card crosses its target, once per
// crossing (notified_at re-arms when it goes back the other way). ─────────────
async function targetAlerts(
  svc: SupabaseClient, uid: string, devices: StoredSubscription[], stale: Set<string>, notes: string[],
): Promise<number> {
  let hits = 0;
  try {
    const { rows } = await readAll<{ card_id: string; target_price: number; direction: string; notified_at: string | null; cards: CardMeta | CardMeta[] }>(
      (from, to) => svc
        .from("card_alerts")
        .select("card_id, target_price, direction, notified_at, cards!inner ( user_id, player, year, set_name, market_value, manual_price )")
        .eq("kind", "target")            // a pct_move row has a null target — never treat it as $0
        .eq("cards.user_id", uid)
        .range(from, to),
    );
    for (const a of rows) {
      const c = one(a.cards);
      const value = priceOf(c);
      if (value == null) continue;
      const target = Number(a.target_price);
      const crossed = a.direction === "below" ? value <= target : value >= target;
      if (crossed && !a.notified_at) {
        const r = await sendToAll(devices, {
          title: `🔔 ${label(c)}`,
          body: `Hit your target ${a.direction === "below" ? "≤" : "≥"} $${target} — now $${value}`,
          url: "/cards/watchlist",
        });
        r.stale.forEach((s) => stale.add(s));
        await svc.from("card_alerts").update({ notified_at: new Date().toISOString() }).eq("card_id", a.card_id);
        hits++;
      } else if (!crossed && a.notified_at) {
        await svc.from("card_alerts").update({ notified_at: null }).eq("card_id", a.card_id);
      }
    }
  } catch (e) {
    notes.push(`target/${uid}: ${e instanceof Error ? e.message : "failed"}`);
  }
  return hits;
}

// ── %-move alerts: fire when a watched card moves ≥ threshold% within its
// window, once per crossing (re-arms when it falls back under). ───────────────
async function pctAlerts(
  svc: SupabaseClient, uid: string, devices: StoredSubscription[], stale: Set<string>, notes: string[],
): Promise<number> {
  let hits = 0;
  try {
    const now = Date.now();
    const { rows } = await readAll<{ card_id: string; threshold_pct: number; window_days: number; notified_at: string | null; cards: CardMeta | CardMeta[] }>(
      (from, to) => svc
        .from("card_alerts")
        .select("card_id, threshold_pct, window_days, notified_at, cards!inner ( user_id, player, year, set_name, market_value, manual_price )")
        .eq("kind", "pct_move")
        .eq("cards.user_id", uid)
        .range(from, to),
    );
    for (const a of rows) {
      const c = one(a.cards);
      const cur = priceOf(c);
      const win = Number(a.window_days) || 7;
      const thr = Number(a.threshold_pct) || 0;
      if (cur == null || thr <= 0) continue;
      const since = new Date(now - Math.max(win * 3, 90) * 86_400_000).toISOString();
      const { rows: h } = await readAll<{ price: number; ts: string }>(
        (from, to) => svc
          .from("card_price_history").select("price, ts").eq("card_id", a.card_id)
          .gte("ts", since).order("ts", { ascending: true }).range(from, to),
        MAX_HISTORY,
      );
      const pts: PricePoint[] = h.map((r) => ({ price: Number(r.price), at: new Date(r.ts).getTime() }));
      const m = pctChangeOverWindow([...pts, { price: cur, at: now }], win, now);
      if (!m) continue;
      const crossed = Math.abs(m.pct) >= thr;
      if (crossed && !a.notified_at) {
        const r = await sendToAll(devices, {
          title: `📈 ${label(c)}`,
          body: `${m.pct > 0 ? "+" : ""}${m.pct.toFixed(1)}% in ${win}d — now $${cur}`,
          url: "/cards/movers",
        });
        r.stale.forEach((s) => stale.add(s));
        await svc.from("card_alerts").update({ notified_at: new Date().toISOString() }).eq("card_id", a.card_id);
        hits++;
      } else if (!crossed && a.notified_at) {
        await svc.from("card_alerts").update({ notified_at: null }).eq("card_id", a.card_id);
      }
    }
  } catch (e) {
    notes.push(`pct/${uid}: ${e instanceof Error ? e.message : "failed"}`);
  }
  return hits;
}

// ── Daily top-movers digest — a generated standard (default ±15%/7d, tunable in
// prefs.cardops.movers). One push naming the biggest movers in YOUR inventory. ─
async function moversDigest(
  svc: SupabaseClient, uid: string, devices: StoredSubscription[], stale: Set<string>, notes: string[],
): Promise<number> {
  try {
    const now = Date.now();
    // This is a read-modify-write of the WHOLE prefs blob, so a discarded read
    // error would mean writing `{cardops:{movers_seen}}` over everything else the
    // user has in there — grading fees, eBay listing prefs and cached policy ids,
    // tax prefs, calendar/todo prefs. There is no versioning and no undo. Bail
    // instead. (2026-07-24)
    const { data: pref, error: prefErr } = await svc
      .from("user_settings").select("prefs").eq("user_id", uid).maybeSingle();
    if (prefErr) {
      notes.push(`movers/${uid}: prefs read failed (${prefErr.message}) — skipped rather than risk overwriting prefs`);
      return 0;
    }
    const prefsObj = (pref?.prefs as Record<string, unknown>) ?? {};
    const cardops = (prefsObj.cardops as { movers?: { enabled?: boolean; pct?: number; days?: number }; movers_seen?: string[] }) ?? {};
    const mv = cardops.movers ?? {};
    if (mv.enabled === false) return 0;
    const seen = new Set(cardops.movers_seen ?? []);
    const pct = Number(mv.pct) > 0 ? Number(mv.pct) : 15;
    const days = Number(mv.days) > 0 ? Math.round(Number(mv.days)) : 7;

    const { rows: cards } = await readAll<{ id: string } & CardMeta>(
      (from, to) => svc
        .from("cards").select("id, player, year, set_name, market_value, manual_price")
        .eq("user_id", uid).not("status", "in", "(archived,sold)").range(from, to),
    );
    if (!cards.length) return 0;
    const meta = new Map(cards.map((c) => [c.id, c]));

    const since = new Date(now - Math.max(days * 3, 90) * 86_400_000).toISOString();
    const { rows: hist, truncated } = await readAll<{ card_id: string; price: number; ts: string }>(
      (from, to) => svc
        .from("card_price_history").select("card_id, price, ts, cards!inner ( user_id )")
        .eq("cards.user_id", uid).gte("ts", since)
        .order("ts", { ascending: false }) // newest-first, so a cap keeps the recent points
        .range(from, to),
      MAX_HISTORY,
    );
    if (truncated) notes.push(`movers/${uid}: price history capped at ${MAX_HISTORY} points`);

    const pts = new Map<string, PricePoint[]>();
    for (const h of hist) {
      if (!meta.has(h.card_id)) continue;
      const arr = pts.get(h.card_id);
      const pt = { price: Number(h.price), at: new Date(h.ts).getTime() };
      if (arr) arr.push(pt); else pts.set(h.card_id, [pt]);
    }

    const digest = buildMoversDigest(cards, pts, { pct, days, now, seen });
    let sent = 0;
    if (digest.push) {
      const r = await sendToAll(devices, digest.push);
      r.stale.forEach((s) => stale.add(s));
      sent = 1;
    }
    const nextPrefs = { ...prefsObj, cardops: { ...cardops, movers_seen: digest.seenNext } };
    await svc.from("user_settings").upsert({ user_id: uid, prefs: nextPrefs }, { onConflict: "user_id" });
    return sent;
  } catch (e) {
    notes.push(`movers/${uid}: ${e instanceof Error ? e.message : "failed"}`);
    return 0;
  }
}
