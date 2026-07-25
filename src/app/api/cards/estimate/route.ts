// CardOps Estimated Price (Beau, 2026-07-22). On-demand AI valuation, two modes:
//   standard_plus (A): start from the card's pricing-standard value, adjust with
//     comparables + player/market context.
//   all_sales_plus (B): ignore the template — reason over ALL of the card's sales
//     + comparables + conditions (for high-end / low-pop cards a thin median lies).
// MANAGED model: the app holds the AI + Card API keys; each run debits the user's
// credit ledger. AI kill-switch gated, card-access only, cached so re-viewing is free.
// The engine itself lives in lib/cards/estimate-run so the scheduled pass shares it.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { estimateCost, normalizeEstimate, type EstimateConfig } from "@/lib/cards/credits";
import { runEstimate, type EstimateCard } from "@/lib/cards/estimate-run";
import { recordAiUsage } from "@/lib/ai/usage";
import { creditEnforcement, creditAvailable } from "@/lib/ai/credit-gate";
import { MODEL, HAIKU_MODEL } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EST_COLS = "mode, value, low, high, confidence, rationale, sources, credits_spent, model, created_at";
const EST_MODES = ["standard_plus", "all_sales_plus"] as const;
export const CARD_COLS = "id, player, year, set_name, card_number, parallel, sport_category, grader, grade, condition_type, market_value, manual_price";

// Balance via the SQL aggregate (credit_balance() = sum for auth.uid()), not a
// client-side sum of the whole append-only ledger. Degrades to 0 pre-migration.
async function balanceOf(supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { data } = await supabase.rpc("credit_balance");
  return Number(data ?? 0);
}

// Newest estimate per mode via one bounded query each — never a limited window
// that can hide a mode once the other accumulates rows.
async function latestEstimates(supabase: Awaited<ReturnType<typeof createClient>>, cardId: string) {
  const rows = await Promise.all(
    EST_MODES.map((m) =>
      supabase.from("card_estimates").select(EST_COLS).eq("card_id", cardId).eq("mode", m).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ),
  );
  const out: Record<string, unknown> = {};
  for (const { data } of rows) if (data) out[(data as { mode: string }).mode] = data;
  return out;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const cardId = new URL(request.url).searchParams.get("cardId");
  if (!cardId || !UUID.test(cardId)) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  return NextResponse.json({ estimates: await latestEstimates(supabase, cardId), balance: await balanceOf(supabase) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = createServiceClient();
  const { data: cfg } = svc
    ? await svc.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) return NextResponse.json({ error: "AI is off (Services page)." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { cardId?: string; mode?: string; config?: Partial<EstimateConfig> } | null;
  if (!body?.cardId || !UUID.test(body.cardId)) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  const mode = body.mode === "all_sales_plus" ? "all_sales_plus" : "standard_plus";
  const config = normalizeEstimate({ ...(body.config ?? {}), mode });
  const { credits } = estimateCost(config);

  // RLS scopes this to a card the caller owns.
  const { data: card } = await supabase.from("cards").select(CARD_COLS).eq("id", body.cardId).maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  // Enforcement gate BEFORE the AI call (spend-after-effect means the refusal
  // has to happen here, not in credit_spend). Off = shadow mode, no gate.
  if (svc && credits > 0 && (await creditEnforcement(svc))) {
    const available = await creditAvailable(svc, user.id);
    if (available < credits) {
      return NextResponse.json(
        { error: `Not enough credits — this estimate costs ${credits}, you have ${available}.`, balance: available },
        { status: 402 },
      );
    }
  }

  const res = await runEstimate(supabase, card as unknown as EstimateCard, mode, config);
  if (!res.ok) {
    // The failed call still consumed tokens — measure it, charge nothing.
    if (svc && res.usage) {
      await recordAiUsage(svc, {
        userId: user.id, feature: `estimate:${mode}`, model: config.ai === "deep" ? MODEL : HAIKU_MODEL,
        usage: res.usage, creditsCharged: 0, ref: body.cardId,
      });
    }
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  // Cache the estimate + debit the metered-compute ledger (soft for now — records
  // spend; hard-enforcement flips on with billing). Row first, debit second
  // (rule 7): a failed cache insert re-runs (and re-selects) tomorrow, but it
  // must never CHARGE for an estimate that was never stored.
  const { data: row, error: cacheErr } = svc
    ? await svc.from("card_estimates").insert({
        card_id: body.cardId, mode, value: res.value, low: res.low, high: res.high,
        confidence: res.confidence, rationale: res.rationale, sources: res.sources,
        credits_spent: credits, model: res.model, created_by: user.id,
      }).select("id, created_at").maybeSingle()
    : { data: null, error: null };
  if (svc && credits > 0 && !cacheErr) {
    // FIFO draw from the soonest-expiring grants; records a shortfall rather
    // than refusing (the compute already happened — the gate above is where
    // refusal lives).
    const { error: debErr } = await svc.rpc("credit_spend", {
      p_user: user.id, p_amount: credits, p_reason: `estimate:${mode}`, p_ref: body.cardId,
    });
    if (debErr) console.error(`estimate ${body.cardId}: stored but credits not debited (${debErr.message})`);
  }
  if (svc) {
    await recordAiUsage(svc, {
      userId: user.id, feature: `estimate:${mode}`, model: res.model,
      usage: res.usage, creditsCharged: cacheErr ? 0 : credits, ref: body.cardId,
    });
  }

  return NextResponse.json({
    estimate: {
      mode, value: res.value, low: res.low, high: res.high, confidence: res.confidence,
      rationale: res.rationale, sources: res.sources, credits_spent: credits, model: res.model,
      created_at: row?.created_at ?? null,
    },
    // A failed cache insert is worth showing: the estimate wasn't stored, so
    // the daily auto-run will re-select (and re-bill) this card tomorrow.
    cache_warning: cacheErr ? `Estimate shown but NOT saved (${cacheErr.message}) — not charged; it may re-run tomorrow.` : undefined,
    credits,
    balance: await balanceOf(supabase),
  });
}
