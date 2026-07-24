import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess, getEbayConnection } from "@/lib/ebay/connection";
import { getOrders } from "@/lib/ebay/orders";
import { readAll } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eBay connector Phase 2: pull paid orders and settle each matched card
// through card_sell — real sale price, eBay's actual fee when reported,
// buyer-paid shipping as income. Idempotent by design: card_sales has a
// unique (platform, order_ref) index and card_sell refuses already-sold
// cards, so re-running is always safe.
//
// POST = owner button in the hub. GET = daily Vercel cron (CRON_SECRET),
// running on the service client (card_sell accepts service_role).

// eBay card-category final value fee fallback when the order doesn't report
// the actual fee (13.25% + $0.30 per order).
const estimateFee = (gross: number) => Math.round((gross * 0.1325 + 0.3) * 100) / 100;

// sellerId scopes the card/lot reads when db is the SERVICE client (cron), which
// bypasses RLS. The POST path passes undefined: it uses the user client, so RLS
// already pins the reads to the signed-in owner.
async function runSync(db: SupabaseClient, access: string, sellerId?: string) {
  const ordersRes = await getOrders(access, 90);
  if (!ordersRes.ok) return { error: ordersRes.error };

  // Match set = a membership map: page to COMPLETION with a unique tiebreaker
  // (Speed Book batches share created_at), and ABORT on a failed page — an
  // errored page treated as "the end" once settled against an EMPTY set while
  // reporting ok. Match-set errors are fail-closed, like the guard below.
  let cardRows: { id: string; sku: string | null; status: string; listing_refs: unknown }[];
  try {
    const r = await readAll<{ id: string; sku: string | null; status: string; listing_refs: unknown }>(
      (from, to) => {
        let q = db
          .from("cards")
          .select("id, sku, status, listing_refs")
          .not("listing_refs", "eq", "{}");
        if (sellerId) q = q.eq("user_id", sellerId);
        return q
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
      });
    cardRows = r.rows;
  } catch (e) {
    return { error: `card match set unavailable: ${e instanceof Error ? e.message : "read failed"}` };
  }
  // Durable cancelled-order guard: never re-settle an order we already
  // seller-cancelled, even while eBay's feed still reports it PAID. If we can't
  // READ the guard — or read it INCOMPLETELY (the silent 1000-row cap is not an
  // error) — abort: settling blind risks re-booking a refunded order.
  let cancelledOrders: Set<string>;
  try {
    const r = await readAll<{ order_ref: string }>((from, to) =>
      db.from("ebay_cancelled_orders").select("order_ref")
        .order("order_ref", { ascending: true }).range(from, to));
    cancelledOrders = new Set(r.rows.map((x) => x.order_ref));
  } catch (e) {
    return { error: `cancelled-order guard unavailable: ${e instanceof Error ? e.message : "read failed"}` };
  }

  const byListingId = new Map<string, { id: string; sku: string | null; status: string }>();
  const bySku = new Map<string, { id: string; sku: string | null; status: string }>();
  for (const c of cardRows) {
    const stub = { id: c.id, sku: c.sku ?? null, status: c.status };
    const lid = ((c.listing_refs as Record<string, { listing_id?: string }> | null)?.ebay)?.listing_id;
    if (lid) byListingId.set(String(lid), stub);
    if (stub.sku) bySku.set(stub.sku, stub);
  }

  // Lot listings settle through card_lot_sell (splits proceeds across children).
  // Same membership-map rules as the cards read: complete, ordered, fail-closed.
  let lotRows: { id: string; sku: string | null; status: string; listing_refs: unknown }[];
  try {
    const r = await readAll<{ id: string; sku: string | null; status: string; listing_refs: unknown }>(
      (from, to) => {
        let q = db.from("card_lots").select("id, sku, status, listing_refs").not("listing_refs", "eq", "{}");
        if (sellerId) q = q.eq("user_id", sellerId);
        return q.order("id", { ascending: true }).range(from, to);
      });
    lotRows = r.rows;
  } catch (e) {
    return { error: `lot match set unavailable: ${e instanceof Error ? e.message : "read failed"}` };
  }
  const lotByListingId = new Map<string, { id: string; sku: string | null; status: string }>();
  const lotBySku = new Map<string, { id: string; sku: string | null; status: string }>();
  for (const l of lotRows ?? []) {
    const stub = { id: l.id as string, sku: (l.sku as string) ?? null, status: l.status as string };
    const lid = ((l.listing_refs as Record<string, { listing_id?: string }> | null)?.ebay)?.listing_id;
    if (lid) lotByListingId.set(String(lid), stub);
    if (stub.sku) lotBySku.set(stub.sku, stub);
  }

  const settled: { sku: string | null; title: string; net: number }[] = [];
  let skipped = 0;
  const failures: string[] = [];

  for (const order of ordersRes.orders) {
    if (order.paymentStatus !== "PAID") continue;
    // Never settle a cancelled order — both eBay's (eventually-consistent)
    // cancel state AND our durable local marker (set the instant we cancel).
    if (order.cancelState && order.cancelState !== "NONE_REQUESTED") continue;
    if (cancelledOrders.has(order.orderId)) continue;
    // Split order-level shipping + fee across lines by item value (usually one
    // card = whole order, but combined checkouts must divide correctly).
    const orderItems = order.lineItems.reduce((s, li) => s + li.itemCost, 0) || 1;
    for (const li of order.lineItems) {
      const card =
        (li.legacyItemId && byListingId.get(li.legacyItemId)) ||
        (li.sku && bySku.get(li.sku)) || null;
      const lot = !card
        ? (li.legacyItemId && lotByListingId.get(li.legacyItemId)) || (li.sku && lotBySku.get(li.sku)) || null
        : null;
      if (!card && !lot) continue;

      const share = li.itemCost / orderItems;
      const shipIncome = Math.round(order.deliveryCost * share * 100) / 100;
      // itemCost is item-only (NOT li.total, which includes shipping).
      const salePrice = li.itemCost;
      const fees = order.marketplaceFee != null
        ? Math.round(order.marketplaceFee * share * 100) / 100
        : estimateFee(salePrice + shipIncome);
      // Per-line order_ref so a combined order can settle every line (the
      // unique (platform, order_ref) index is per line, not per order).
      const orderRef = order.lineItems.length > 1 ? `${order.orderId}:${li.lineItemId}` : order.orderId;

      // ── LOT line: settle the whole bundle via card_lot_sell (splits across
      //    children internally; its status guard makes re-runs idempotent). ──
      if (lot) {
        if (lot.status === "sold") { skipped++; continue; }
        const { error: lErr } = await db.rpc("card_lot_sell", {
          p_lot_id: lot.id, p_platform: "ebay", p_sale_price: salePrice,
          p_fees: fees, p_ship_income: shipIncome, p_ship_cost: 0, p_order_ref: orderRef,
        });
        if (lErr) {
          // 'not sellable' = the lot's own idempotency guard (already settled —
          // benign). A child 'already sold' means the WHOLE bundle sale rolled
          // back and never booked — that's a real failure, surface it loudly.
          if (/not sellable|duplicate key/i.test(lErr.message)) skipped++;
          else failures.push(`lot ${lot.sku}: ${lErr.message}`);
          continue;
        }
        lot.status = "sold";
        settled.push({ sku: lot.sku, title: li.title, net: 0 });
        const { data: freshL } = await db.from("card_lots").select("listing_refs").eq("id", lot.id).maybeSingle();
        const refsL = (freshL?.listing_refs ?? {}) as Record<string, unknown>;
        refsL.ebay = { ...(typeof refsL.ebay === "object" ? refsL.ebay : {}), status: "sold", order_ref: order.orderId };
        await db.from("card_lots").update({ listing_refs: refsL }).eq("id", lot.id);
        continue;
      }

      const c = card!; // narrowed: reached only when a card (not a lot) matched
      if (c.status === "sold") { skipped++; continue; }
      const { data, error } = await db.rpc("card_sell", {
        p_card_id: c.id,
        p_platform: "ebay",
        p_sale_price: salePrice,
        p_fees: fees,
        p_ship_income: shipIncome,
        p_ship_cost: 0,
        p_order_ref: orderRef,
      });
      if (error) {
        // Unique-index dupes and already-sold races are expected noise.
        if (/already sold|duplicate key/i.test(error.message)) skipped++;
        else failures.push(`${c.sku ?? li.title}: ${error.message}`);
        continue;
      }
      c.status = "sold";
      const net = Number((data as { net?: number } | null)?.net ?? 0);
      settled.push({ sku: c.sku, title: li.title, net });

      // Flip the listing ref so the hub shows it sold. Guard the write so a
      // relist/end racing in parallel can't be clobbered back to a live state.
      const { data: fresh } = await db.from("cards").select("listing_refs").eq("id", c.id).maybeSingle();
      const refs = (fresh?.listing_refs ?? {}) as Record<string, unknown>;
      refs.ebay = { ...(typeof refs.ebay === "object" ? refs.ebay : {}), status: "sold", order_ref: order.orderId };
      await db.from("cards").update({ listing_refs: refs }).eq("id", c.id);
      // The per-order settlement trail must exist — a failed write lands in
      // failures[] (loud in the response and run summary), settlement stands.
      try {
        await auditOrThrow(db, {
          actor: "ebay-sync", action: "ebay_settled", target: c.sku ?? c.id,
          payload: { orderId: order.orderId, sale: salePrice, fees, shipping: shipIncome, net },
          result: "ok",
        });
      } catch (e) {
        failures.push(`${order.orderId}: ${e instanceof Error ? e.message : "audit write failed"}`);
      }
    }
  }

  return { settled, skipped, failures, checked: ordersRes.orders.length };
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const out = await runSync(supabase, access);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...out });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });

  const conn = await getEbayConnection(svc);
  if (!conn) return NextResponse.json({ ok: true, note: "eBay not connected — nothing to sync." });

  // Service client → no RLS. Settle only the connected seller's own cards.
  const out = await runSync(svc, conn.access, conn.userId);
  if ("error" in out) {
    await auditOrThrow(svc, {
      actor: "cron", action: "ebay_sync", target: "orders",
      payload: { error: out.error }, result: "error",
    });
    return NextResponse.json({ error: out.error }, { status: 502 });
  }
  if (out.settled.length || out.failures.length) {
    await auditOrThrow(svc, {
      actor: "cron", action: "ebay_sync", target: "orders",
      payload: { settled: out.settled.length, skipped: out.skipped, failures: out.failures },
      result: out.failures.length ? "partial" : "ok",
    });
  }
  return NextResponse.json({ ok: true, ...out });
}
