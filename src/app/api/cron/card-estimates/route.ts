// Daily automatic estimates (Beau, 2026-07-24). Beau's spec: default ON, cheap
// model, with options to turn it off or spend a deeper one. Each user's policy
// lives in card_user_prefs; this pass finds the cards that have no estimate yet
// (or a stale one) and fills them in, so a card is never sitting there blank.
//
// Cost discipline — AI is the only expensive part of CardOps, so:
//   · per-user and global caps per run, oldest/never-estimated first
//   · the cheap model unless the user opted into the deep one
//   · a fresh estimate is skipped, not recomputed
//   · every run is metered to the owner's credit ledger, same as a manual one
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readAll } from "@/lib/supabase/page";
import { estimateCost, normalizeEstimate } from "@/lib/cards/credits";
import { runEstimate, type EstimateCard, type EstimateMode } from "@/lib/cards/estimate-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_USER = 20;   // cards touched per user per run
const GLOBAL = 80;     // total estimates per run
const STALE_DAYS = 14; // refresh an estimate older than this
const CARD_COLS = "id, player, year, set_name, card_number, parallel, sport_category, grader, grade, condition_type, market_value, manual_price";

const MODES: Record<string, EstimateMode[]> = {
  A: ["standard_plus"],
  B: ["all_sales_plus"],
  both: ["standard_plus", "all_sales_plus"],
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });

  // Respect the same AI kill-switch as everything else.
  const { data: cfg } = await svc.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle();
  if (!cfg?.enabled) return NextResponse.json({ ok: true, skipped: "AI is off." });

  const { data: prefs, error: prefErr } = await svc
    .from("card_user_prefs").select("user_id, auto_estimate, estimate_model").neq("auto_estimate", "off");
  if (prefErr) return NextResponse.json({ error: prefErr.message }, { status: 500 });
  if (!prefs?.length) return NextResponse.json({ ok: true, note: "nobody has automatic estimates on" });

  // Paid work follows the ROLE roster, not stale prefs: a demoted user's cards
  // must stop spending the owner's AI budget the day their role changes.
  const { data: roster, error: rosterErr } = await svc
    .from("profiles").select("id").in("role", ["owner", "card_ops"]);
  if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 });
  const allowed = new Set((roster ?? []).map((r) => r.id as string));

  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  // Leave 60s of the 300s budget for the tail (audit write + response):
  // hitting the wall mid-user is fine, silently dying at 300s is not.
  const deadline = Date.now() + 240_000;
  let made = 0, skipped = 0, failed = 0;
  let deadlineHit = false;
  const errors: string[] = [];

  for (const p of prefs) {
    if (made >= GLOBAL || deadlineHit) break;
    const userId = p.user_id as string;
    if (!allowed.has(userId)) { skipped++; continue; }
    try {
    const modes = MODES[String(p.auto_estimate)] ?? [];
    if (!modes.length) continue;
    const ai = p.estimate_model === "deep" ? "deep" : "light";

    // Pick the candidates from the WHOLE inventory, not from a fixed window.
    //
    // This used to read `order(created_at asc).limit(PER_USER * 3)` and then skip
    // anything already fresh — but a skip doesn't consume budget, so the window
    // never advanced. With more than ~60 live cards, the tail never received a
    // first estimate at all, and the ascending sort starved the NEWEST cards,
    // which are exactly the blank ones this job exists to fill. Now: list every
    // live card id, subtract the ones with a fresh estimate, and spend the budget
    // on never-estimated cards first, then the stalest. (2026-07-24)
    const { rows: allCards } = await readAll<{ id: string; created_at: string }>(
      (from, to) => svc.from("cards").select("id, created_at")
        .eq("user_id", userId).not("status", "in", "(archived,sold)")
        .order("id", { ascending: true }).range(from, to),
      20_000,
    );
    if (!allCards.length) continue;

    // Latest estimate per (card, mode) — `fresh` skips, the rest sorts by age.
    // Scoped through the card's owner rather than an `.in(<every id>)` list — a
    // 20k-element IN would blow the request URL length.
    const { rows: estRows } = await readAll<{ card_id: string; mode: string; created_at: string }>(
      (from, to) => svc.from("card_estimates").select("card_id, mode, created_at, cards!inner(user_id)")
        .eq("cards.user_id", userId)
        .order("card_id", { ascending: true }).order("created_at", { ascending: false })
        .range(from, to),
      100_000,
    );
    const lastAt = new Map<string, number>();
    for (const e of estRows) {
      const k = `${e.card_id}::${e.mode}`;
      const t = new Date(e.created_at).getTime();
      if (!lastAt.has(k) || t > lastAt.get(k)!) lastAt.set(k, t);
    }
    const cutoffMs = new Date(cutoff).getTime();

    // Never-estimated first (-Infinity), then oldest estimate first.
    const candidates: { card: { id: string; created_at: string }; mode: EstimateMode; age: number }[] = [];
    for (const card of allCards) {
      for (const mode of modes) {
        const at = lastAt.get(`${card.id}::${mode}`);
        if (at !== undefined && at >= cutoffMs) { skipped++; continue; } // still fresh
        candidates.push({ card, mode, age: at ?? Number.NEGATIVE_INFINITY });
      }
    }
    candidates.sort((a, b) => a.age - b.age);

    // Hydrate only the cards we'll actually estimate.
    const pick = candidates.slice(0, PER_USER);
    const pickIds = [...new Set(pick.map((p) => p.card.id))];
    if (!pickIds.length) continue;
    const { data: full } = await svc.from("cards").select(CARD_COLS).in("id", pickIds);
    const byId = new Map((full ?? []).map((c) => [c.id as string, c]));

    let forUser = 0;
    for (const { card: stub, mode } of pick) {
      if (forUser >= PER_USER || made >= GLOBAL) break;
      if (Date.now() > deadline) {
        deadlineHit = true;
        errors.push(`time budget reached — remaining candidates roll to tomorrow's run`);
        break;
      }
      const card = byId.get(stub.id);
      if (!card) continue;

      const config = normalizeEstimate({ mode, ai });
      const { credits } = estimateCost(config);
      try {
        const res = await runEstimate(svc, card as unknown as EstimateCard, mode, config);
        if (!res.ok) { failed++; errors.push(`${card.id} ${mode}: ${res.error}`); continue; }
        // Row first, debit second (rule 7): a failed insert must not charge
        // credits for an estimate that doesn't exist.
        const { error: insErr } = await svc.from("card_estimates").insert({
          card_id: card.id, mode, value: res.value, low: res.low, high: res.high,
          confidence: res.confidence, rationale: res.rationale, sources: res.sources,
          credits_spent: credits, model: res.model, created_by: userId,
        });
        if (insErr) { failed++; errors.push(`${card.id} ${mode}: estimate not stored (${insErr.message}) — not charged`); continue; }
        if (credits > 0) {
          const { error: debErr } = await svc.from("credit_ledger")
            .insert({ user_id: userId, delta: -credits, reason: `auto-estimate:${mode}`, ref: card.id });
          if (debErr) errors.push(`${card.id} ${mode}: estimate stored but credits not debited (${debErr.message})`);
        }
        made++; forUser++;
      } catch (e) {
        failed++;
        errors.push(`${card.id} ${mode}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    } catch (e) {
      // One user's failed reads must not starve everyone after them (rule 11).
      failed++;
      errors.push(`user ${userId}: ${e instanceof Error ? e.message : "failed"} — continuing with the next user`);
    }
  }

  return NextResponse.json({
    ok: true, made, skipped_fresh: skipped, failed, users: prefs.length,
    deadlineHit: deadlineHit || undefined, errors: errors.slice(0, 10),
  });
}
