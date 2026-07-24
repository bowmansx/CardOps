import { ebayApi } from "./listing";
import { EBAY_HOSTS } from "./oauth";

// Fulfillment API (orders + shipping), Negotiation API (send offers), and
// Post-Order API (cancellations). Lean parsed shapes — the hub reads directly.

export type EbayOrderItem = {
  lineItemId: string;
  legacyItemId: string | null; // matches listing_refs.ebay.listing_id
  sku: string | null;
  title: string;
  // eBay's lineItem.total INCLUDES delivery cost (and tax). itemCost is the
  // item-only price (lineItemCost) — that's what a card sold for. Settlement
  // math must use itemCost, never total, or shipping gets double-counted.
  itemCost: number;
  total: number; // buyer-facing line total (item + shipping + tax); display only
};

export type EbayOrder = {
  orderId: string;
  createdAt: string;
  paymentStatus: string;      // PAID | PENDING | …
  fulfillmentStatus: string;  // NOT_STARTED | IN_PROGRESS | FULFILLED
  cancelState: string;        // NONE_REQUESTED | CANCELED | CANCEL_REQUESTED | …
  buyer: string | null;
  total: number;              // grand total buyer paid
  subtotal: number;           // items only
  deliveryCost: number;       // shipping the buyer paid
  marketplaceFee: number | null; // eBay's actual fee when reported
  shipTo: { name: string | null; city: string | null; state: string | null; zip: string | null };
  lineItems: EbayOrderItem[];
};

type RawOrder = {
  orderId?: string;
  creationDate?: string;
  orderPaymentStatus?: string;
  orderFulfillmentStatus?: string;
  cancelStatus?: { cancelState?: string };
  buyer?: { username?: string };
  pricingSummary?: {
    total?: { value?: string };
    priceSubtotal?: { value?: string };
    deliveryCost?: { value?: string };
  };
  totalMarketplaceFee?: { value?: string };
  fulfillmentStartInstructions?: {
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: { city?: string; stateOrProvince?: string; postalCode?: string };
      };
    };
  }[];
  lineItems?: {
    lineItemId?: string;
    legacyItemId?: string;
    sku?: string;
    title?: string;
    lineItemCost?: { value?: string };
    total?: { value?: string };
    deliveryCost?: { shippingCost?: { value?: string } };
  }[];
};

const num = (v: string | undefined | null): number => (v != null ? Number(v) : 0);

function parseOrder(o: RawOrder): EbayOrder {
  const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  return {
    orderId: o.orderId ?? "",
    createdAt: o.creationDate ?? "",
    paymentStatus: o.orderPaymentStatus ?? "",
    fulfillmentStatus: o.orderFulfillmentStatus ?? "",
    cancelState: o.cancelStatus?.cancelState ?? "NONE_REQUESTED",
    buyer: o.buyer?.username ?? null,
    total: num(o.pricingSummary?.total?.value),
    subtotal: num(o.pricingSummary?.priceSubtotal?.value),
    deliveryCost: num(o.pricingSummary?.deliveryCost?.value),
    marketplaceFee: o.totalMarketplaceFee?.value != null ? Number(o.totalMarketplaceFee.value) : null,
    shipTo: {
      name: ship?.fullName ?? null,
      city: ship?.contactAddress?.city ?? null,
      state: ship?.contactAddress?.stateOrProvince ?? null,
      zip: ship?.contactAddress?.postalCode ?? null,
    },
    lineItems: (o.lineItems ?? []).map((li) => {
      const total = num(li.total?.value);
      const lineShip = num(li.deliveryCost?.shippingCost?.value);
      // Prefer eBay's explicit item-only price; else back it out of total.
      const itemCost = li.lineItemCost?.value != null ? num(li.lineItemCost.value) : Math.max(0, total - lineShip);
      return {
        lineItemId: li.lineItemId ?? "",
        legacyItemId: li.legacyItemId ?? null,
        sku: li.sku ?? null,
        title: li.title ?? "",
        itemCost,
        total,
      };
    }),
  };
}

export async function getOrders(
  access: string,
  daysBack = 90,
): Promise<{ ok: true; orders: EbayOrder[]; truncated: boolean } | { ok: false; error: string }> {
  const since = new Date(Date.now() - daysBack * 86400_000).toISOString();
  const orders: EbayOrder[] = [];
  // Page to completion up to a sanity cap (30 pages ≈ 3000 orders in the
  // window). Hitting the cap without a short page = TRUNCATED, and callers
  // must surface that (rule 10) — the old silent 300 cap meant a busy month
  // could push a PAID order out of sight so it never settled.
  const MAX = 3000;
  let sawEnd = false;
  for (let offset = 0; offset < MAX; offset += 100) {
    const filter = encodeURIComponent(`creationdate:[${since}..]`);
    const r = await ebayApi<{ orders?: RawOrder[]; total?: number }>(
      access, "GET", `/sell/fulfillment/v1/order?filter=${filter}&limit=100&offset=${offset}`,
    );
    if (!r.ok) return { ok: false, error: r.error ?? "getOrders failed" };
    const batch = (r.data?.orders ?? []).map(parseOrder);
    orders.push(...batch);
    if (batch.length < 100) { sawEnd = true; break; }
  }
  return { ok: true, orders, truncated: !sawEnd };
}

export async function shipOrder(
  access: string,
  orderId: string,
  carrier: string,
  tracking: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const got = await ebayApi<RawOrder>(access, "GET", `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`);
  if (!got.ok || !got.data) return { ok: false, error: got.error ?? "order not found" };
  const lineItems = (got.data.lineItems ?? [])
    .map((li) => ({ lineItemId: li.lineItemId ?? "", quantity: 1 }))
    .filter((li) => li.lineItemId);
  if (!lineItems.length) return { ok: false, error: "order has no line items" };
  const r = await ebayApi(access, "POST", `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, {
    lineItems,
    shippingCarrierCode: carrier,
    trackingNumber: tracking,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "shipping fulfillment failed" };
}

const MARKETPLACE = { "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };

// Listings whose watchers/cart-adders eBay will let us send a private
// discount offer to. Non-fatal everywhere it's used.
export async function findEligibleOfferListings(
  access: string,
): Promise<{ ok: true; listingIds: string[] } | { ok: false; error: string }> {
  const r = await ebayApi<{ eligibleItems?: { listingId?: string }[] }>(
    access, "GET", "/sell/negotiation/v1/find_eligible_items?limit=200", undefined, MARKETPLACE,
  );
  if (!r.ok) return { ok: false, error: r.error ?? "find_eligible_items failed" };
  return { ok: true, listingIds: (r.data?.eligibleItems ?? []).map((e) => e.listingId!).filter(Boolean) };
}

export async function sendOfferToInterestedBuyers(
  access: string,
  listingId: string,
  price: number,
  message?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await ebayApi(access, "POST", "/sell/negotiation/v1/send_offer_to_interested_buyers", {
    allowCounterOffer: false,
    ...(message ? { message: message.slice(0, 2000) } : {}),
    offeredItems: [{ listingId, quantity: 1, price: { currency: "USD", value: price.toFixed(2) } }],
  }, MARKETPLACE);
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "send offer failed" };
}

export const CANCEL_REASONS = ["OUT_OF_STOCK_OR_CANNOT_FULFILL", "BUYER_ASKED_CANCEL"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

// Seller-initiated order cancellation (refunds the buyer). This lives in the
// legacy Post-Order API, which uses `Authorization: IAF <token>` — not the
// Bearer scheme the REST Sell APIs use — so it gets its own fetch.
export async function cancelOrder(
  access: string,
  orderId: string,
  reason: CancelReason,
): Promise<{ ok: true; cancelId: string | null } | { ok: false; error: string }> {
  const res = await fetch(`${EBAY_HOSTS.api}/post-order/v2/cancellation`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `IAF ${access}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    body: JSON.stringify({ legacyOrderId: orderId, cancelReason: reason }),
  });
  const text = await res.text();
  let data: { cancelId?: string; errors?: { message?: string; longMessage?: string }[]; warnings?: { message?: string; longMessage?: string }[] } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (res.ok) return { ok: true, cancelId: data?.cancelId ?? null };
  const err =
    [...(data?.errors ?? []), ...(data?.warnings ?? [])]
      .map((e) => e.longMessage ?? e.message).filter(Boolean).join(" · ")
    || text.slice(0, 400) || `Post-Order ${res.status}`;
  return { ok: false, error: err };
}
