import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { cancelOrder, CANCEL_REASONS, type CancelReason } from "@/lib/ebay/orders";
import { reverseOrderSettlement } from "@/lib/ebay/reverse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Seller-cancel an eBay order (refunds the buyer). If the order was already
// settled into the books, reverse each matched card via card_unsell so the
// sale + pool draw are undone. POST { orderId, reason? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { orderId?: string; reason?: string } | null;
  // eBay order ids are digits + dashes only. Restricting to that also keeps
  // LIKE wildcards ('_', '%') out of the PostgREST .or() filter below.
  if (!body?.orderId || !/^[0-9-]+$/.test(body.orderId)) {
    return NextResponse.json({ error: "Valid orderId required." }, { status: 400 });
  }
  const reason: CancelReason = CANCEL_REASONS.includes(body.reason as CancelReason)
    ? (body.reason as CancelReason)
    : "OUT_OF_STOCK_OR_CANNOT_FULFILL";

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const r = await cancelOrder(access, body.orderId, reason);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  // From here the buyer IS refunded on eBay — every subsequent failure must be
  // surfaced (never a clean success), or we'd leave the books out of sync.
  const problems: string[] = [];

  // Mark it cancelled BEFORE reversing, so a sync racing us can't re-settle it
  // (the durable guard eBay's eventually-consistent state can't give us). If
  // THIS write fails the guard is defeated — that's a loud problem, not fire-
  // and-forget.
  const { error: markErr } = await supabase.from("ebay_cancelled_orders")
    .upsert({ order_ref: body.orderId }, { onConflict: "order_ref" });
  if (markErr) problems.push(`couldn't record the cancelled-order guard (${markErr.message}) — a sync could re-settle it`);

  // Reverse any settlement tied to this order via the shared helper: single
  // cards through card_unsell; LOT children through card_lot_unsell once per
  // lot (reversing children one-by-one stranded the lot row in 'sold').
  const rev = await reverseOrderSettlement(supabase, body.orderId);
  problems.push(...rev.problems);
  const reversed = rev.reversedCards + rev.reversedLots;

  await auditOrThrow(supabase, {
    actor: "web", action: "ebay_order_cancelled", target: body.orderId,
    payload: { reason, cancelId: r.cancelId, reversedCards: rev.reversedCards, reversedLots: rev.reversedLots, problems },
    result: problems.length ? "partial" : "ok",
  });

  // Buyer refunded regardless — but if anything after the refund failed, say so
  // loudly rather than reporting a clean success.
  if (problems.length) {
    return NextResponse.json({
      ok: true, cancelId: r.cancelId, reversed,
      warning: `Order cancelled & buyer refunded, but follow-up steps need attention: ${problems.join("; ")}. Fix the card status manually.`,
    });
  }
  return NextResponse.json({ ok: true, cancelId: r.cancelId, reversed });
}
