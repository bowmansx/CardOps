import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { parsePastedSales } from "@/lib/cards/paste-sales";
import { salesToRows } from "@/lib/cards/market-sales";
import { manualSource } from "@/lib/cards/price-sources";
import type { PriceBasis } from "@/lib/cards/price-basis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Import pasted sold comps (Beau, 2026-07-29). The lane no API sells: Terapeak,
// 130point, an auction house's prices-realized page.
//
// TWO CALLS, ALWAYS. `dryRun` parses and returns a preview with every rejection;
// the second call writes. This is the highest-risk write in the app —
// card_market_sales hangs off the SHARED identity, so one bad paste reaches
// every owner of that card (GO-LIVE.md: shared-catalogue poisoning) — and a
// human confirming what was parsed is the only real defence available before
// there is a dispute path.
//
// The write goes through `salesToRows`, so the licence gate applies to a paste
// exactly as it does to a vendor feed.

type Body = {
  cardId?: string;
  text?: string;
  source?: string;
  /** What the pasted prices include. Required — see below. */
  priceBasis?: PriceBasis;
  dryRun?: boolean;
};

const BASES: PriceBasis[] = ["all_in", "hammer", "unknown"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  if (!body.text?.trim()) return NextResponse.json({ error: "Nothing pasted." }, { status: 400 });

  const src = manualSource(body.source ?? "paste-manual");
  if (!src) return NextResponse.json({ error: `Unknown paste source "${body.source}".` }, { status: 400 });

  // The basis must be STATED, not defaulted at this layer. An auction house's
  // realized price is a hammer figure with ~20% still to come; treating it as
  // all-in understates every one of those sales. The form supplies the source's
  // usual meaning as its default and the user can change it — but the request
  // has to carry an answer.
  const priceBasis = body.priceBasis;
  if (!priceBasis || !BASES.includes(priceBasis)) {
    return NextResponse.json(
      { error: "priceBasis must be one of all_in, hammer, unknown — say what the pasted prices include." },
      { status: 400 },
    );
  }

  // RLS scopes this to the caller's own cards, so a paste can only ever be
  // attached to a card they can see.
  const { data: card, error: cardErr } = await supabase
    .from("cards").select("id, identity_id").eq("id", body.cardId).maybeSingle();
  if (cardErr) return NextResponse.json({ error: cardErr.message }, { status: 500 });
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  const parsed = parsePastedSales(body.text, {
    source: src.id,
    defaultPlatform: src.defaultPlatform,
    priceBasis,
  });

  const preview = {
    source: src.id,
    sourceLabel: src.label,
    priceBasis,
    columns: parsed.columns,
    dateOrder: parsed.dateOrder,
    parsed: parsed.sales.length,
    rejected: parsed.rejected,
    // A short sample so the user can eyeball that the columns were read right
    // before anything is written.
    sample: parsed.sales.slice(0, 8).map((s) => ({
      price: s.price, soldAt: s.soldAt, platform: s.platform,
      grader: s.grader, grade: s.grade, title: s.title,
    })),
    ...(parsed.note ? { note: parsed.note } : {}),
  };

  if (body.dryRun !== false) return NextResponse.json({ ok: true, dryRun: true, ...preview });

  if (!parsed.sales.length) {
    return NextResponse.json({ ok: false, error: "Nothing usable in that paste.", ...preview }, { status: 400 });
  }

  // Sales belong to the shared IDENTITY so every owner of the card inherits
  // them. A card too sparse to fingerprint has no identity, and there is nothing
  // stable to attach history to — say so rather than writing an orphan row.
  if (!card.identity_id) {
    return NextResponse.json({
      ok: false,
      error: "This card can't be fingerprinted yet, so there's no shared identity to attach sales to. Fill in year, set and player first.",
      ...preview,
    }, { status: 409 });
  }

  const batch = salesToRows(card.identity_id, card.id, parsed.sales, src.id);
  if (batch.refusedSource) {
    // Should be unreachable — manual sources declare persist:true — so if it
    // fires, a source was added without rights and that is worth shouting about
    // rather than silently importing nothing.
    return NextResponse.json(
      { ok: false, error: `Source "${batch.refusedSource}" may not be stored under its licence.`, ...preview },
      { status: 500 },
    );
  }

  const { data: written, error } = await supabase
    .from("card_market_sales")
    .upsert(batch.rows, { onConflict: "identity_id,source,external_id", ignoreDuplicates: true })
    .select("external_id");
  // Every write's error is checked and surfaced (rule 1). Reporting a count we
  // did not confirm would be the exact failure that hid a broken conflict target
  // behind a successful-looking run.
  if (error) return NextResponse.json({ ok: false, error: error.message, ...preview }, { status: 500 });

  const inserted = written?.length ?? 0;
  return NextResponse.json({
    ok: true,
    dryRun: false,
    inserted,
    // ignoreDuplicates means a re-paste is a no-op rather than a double-count;
    // say so, or the user reads "0 imported" as a failure.
    alreadyHad: batch.rows.length - inserted,
    ...preview,
  });
}
