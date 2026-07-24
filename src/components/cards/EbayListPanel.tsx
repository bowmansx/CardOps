"use client";

import { useState } from "react";
import { ShoppingCart, Loader2, ExternalLink, Sparkles } from "lucide-react";

type Listed = { url?: string; listing_id?: string; status?: string; listed_at?: string } | null;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * List-on-eBay panel: one flow from card → live listing (fixed or auction).
 * Price slider anchored to computed market value (−99%…+500%), an AI-written
 * description, Best Offer, and the one-time ship-from form. eBay errors verbatim.
 */
export function EbayListPanel({
  cardId,
  defaultTitle,
  suggestedPrice,
  marketValue,
  listed: initialListed,
}: {
  cardId: string;
  defaultTitle: string;
  suggestedPrice: number | null;
  marketValue: number | null;
  listed: Listed;
}) {
  const [listed, setListed] = useState<Listed>(initialListed);
  const [title, setTitle] = useState(defaultTitle);
  const [price, setPrice] = useState(suggestedPrice != null ? String(suggestedPrice) : "");
  const [format, setFormat] = useState<"fixed" | "auction">("fixed");
  const [bestOffer, setBestOffer] = useState(false);
  const [autoAccept, setAutoAccept] = useState("");
  const [autoDecline, setAutoDecline] = useState("");
  const [startBid, setStartBid] = useState("0.99");
  const [days, setDays] = useState("7");
  const [binPrice, setBinPrice] = useState(suggestedPrice != null ? String(suggestedPrice) : "");
  const [description, setDescription] = useState("");
  const [describing, setDescribing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsLoc, setNeedsLoc] = useState(false);
  const [loc, setLoc] = useState({ city: "", state: "", zip: "" });

  // Price slider anchored to the computed market value (fallback: suggested).
  const anchor = marketValue ?? suggestedPrice ?? null;
  const priceNum = Number(price);
  const pctVsMarket = anchor && anchor > 0 && priceNum > 0 ? Math.round((priceNum / anchor - 1) * 100) : null;
  const setPriceFromPct = (pct: number) => {
    if (!anchor || anchor <= 0) return;
    setPrice((anchor * (1 + pct / 100)).toFixed(2));
  };

  async function generateDescription() {
    setDescribing(true);
    setErr(null);
    try {
      const r = await fetch("/api/cards/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
      const text = await r.text();
      let d: { description?: string; error?: string };
      try { d = JSON.parse(text); } catch { throw new Error(`Request failed (HTTP ${r.status}) — try again.`); }
      if (!r.ok || !d.description) throw new Error(d.error || "Couldn't write a description.");
      setDescription(d.description);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't write a description.");
    } finally {
      setDescribing(false);
    }
  }

  async function saveLocation() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ebay/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loc),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Location save failed.");
      setNeedsLoc(false);
      await list(); // continue straight into listing
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Location save failed.");
      setBusy(false);
    }
  }

  async function list() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          price: price ? Number(price) : undefined,
          format,
          ...(format === "fixed" && bestOffer
            ? { bestOffer: { enabled: true, autoAccept: autoAccept ? Number(autoAccept) : undefined, autoDecline: autoDecline ? Number(autoDecline) : undefined } }
            : {}),
          ...(format === "auction"
            ? { auction: { startBid: Number(startBid), days: Number(days), binPrice: binPrice ? Number(binPrice) : undefined } }
            : {}),
        }),
      });
      const text = await r.text();
      let d: Record<string, unknown> & { needsLocation?: boolean; error?: string; url?: string; listingId?: string };
      try { d = JSON.parse(text); } catch { throw new Error(`Request failed (HTTP ${r.status}) — likely a timeout; try again.`); }
      if (r.status === 428 && d.needsLocation) {
        setNeedsLoc(true);
        return;
      }
      if (!r.ok) throw new Error(d.error || "Listing failed.");
      setListed({ url: d.url, listing_id: d.listingId, status: "active" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Listing failed.");
    } finally {
      setBusy(false);
    }
  }

  if (listed?.listing_id && listed.status === "active") {
    return (
      <section className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-pos/30 bg-pos/5 px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-pos">
          <ShoppingCart size={15} /> Live on eBay
        </span>
        <span className="flex items-center gap-3">
          <a href="/cards/ebay" className="text-xs font-bold text-ink/50 underline-offset-2 hover:text-ink hover:underline">
            Manage
          </a>
          <a href={listed.url ?? `https://www.ebay.com/itm/${listed.listing_id}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs font-bold text-flag underline-offset-2 hover:underline">
            View listing <ExternalLink size={12} />
          </a>
        </span>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-hairline bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
        <ShoppingCart size={13} className="text-flag" /> List on eBay
      </div>

      {needsLoc ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-ink/60">One-time setup: where do you ship from? (eBay requires it.)</p>
          <div className="grid grid-cols-3 gap-2">
            <input value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} placeholder="City"
              className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag" />
            <input value={loc.state} onChange={(e) => setLoc({ ...loc, state: e.target.value })} placeholder="State (TN)" maxLength={2}
              className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm uppercase outline-none focus:border-flag" />
            <input value={loc.zip} onChange={(e) => setLoc({ ...loc, zip: e.target.value })} placeholder="ZIP"
              className="figures rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag" />
          </div>
          <button onClick={saveLocation} disabled={busy || !loc.city || loc.state.length !== 2 || !loc.zip}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-flag py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save &amp; list
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {/* Format — full eBay parity: fixed price (w/ Best Offer) or auction */}
          <div className="flex overflow-hidden rounded-lg border border-hairline text-xs font-semibold">
            {(["fixed", "auction"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFormat(f)}
                className={"flex-1 px-3 py-1.5 " + (format === f ? "bg-flag text-white" : "bg-white text-ink/50")}>
                {f === "fixed" ? "Buy It Now" : "Auction"}
              </button>
            ))}
          </div>

          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
            className="w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm outline-none focus:border-flag" />

          {format === "fixed" ? (
            <>
              <div className="flex items-center gap-2">
                <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" min="0.99" placeholder="Price $"
                  className="figures w-28 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm outline-none focus:border-flag" />
                <label className="flex items-center gap-1.5 text-xs text-ink/70">
                  <input type="checkbox" checked={bestOffer} onChange={(e) => setBestOffer(e.target.checked)} className="h-3.5 w-3.5 accent-[#c9a227]" />
                  Accept offers
                </label>
              </div>
              {/* Price slider anchored to market value: −99% … +500% */}
              {anchor != null && anchor > 0 && (
                <div className="rounded-lg border border-hairline bg-paper/40 px-2.5 py-2">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-ink/50">Market <span className="figures font-semibold text-ink/70">{money(anchor)}</span></span>
                    {pctVsMarket != null && (
                      <span className={"figures font-bold " + (pctVsMarket === 0 ? "text-ink/50" : pctVsMarket < 0 ? "text-pos" : "text-flag")}>
                        {pctVsMarket === 0 ? "at market" : pctVsMarket < 0 ? `${Math.abs(pctVsMarket)}% below` : `${pctVsMarket}% above`}
                      </span>
                    )}
                  </div>
                  <input type="range" min={-99} max={500} step={1} value={Math.max(-99, Math.min(500, pctVsMarket ?? 0))}
                    onChange={(e) => setPriceFromPct(Number(e.target.value))}
                    className="mt-1 w-full accent-[#c9a227]" />
                  <div className="flex justify-between text-[9px] text-ink/30"><span>−99%</span><span>market</span><span>+500%</span></div>
                  {pctVsMarket != null && pctVsMarket < 0 && (
                    <p className="mt-0.5 text-[10px] text-pos">The description will note it&apos;s {Math.abs(pctVsMarket)}% below market.</p>
                  )}
                </div>
              )}
              {bestOffer && (
                <div className="flex gap-2">
                  <input value={autoAccept} onChange={(e) => setAutoAccept(e.target.value)} type="number" step="0.01" placeholder="Auto-accept ≥ $"
                    className="figures flex-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-flag" />
                  <input value={autoDecline} onChange={(e) => setAutoDecline(e.target.value)} type="number" step="0.01" placeholder="Auto-decline < $"
                    className="figures flex-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-flag" />
                </div>
              )}
            </>
          ) : (
            <div className="flex gap-2">
              <input value={startBid} onChange={(e) => setStartBid(e.target.value)} type="number" step="0.01" min="0.01" placeholder="Start bid $"
                className="figures w-24 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm outline-none focus:border-flag" />
              <select value={days} onChange={(e) => setDays(e.target.value)}
                className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag">
                {[3, 5, 7, 10].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
              <input value={binPrice} onChange={(e) => setBinPrice(e.target.value)} type="number" step="0.01" placeholder="BIN $ (opt.)"
                className="figures flex-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm outline-none focus:border-flag" />
            </div>
          )}

          {/* Description — AI-written or your own. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/50">Description</span>
              <button onClick={generateDescription} disabled={describing}
                className="flex items-center gap-1 text-[11px] font-bold text-flag disabled:opacity-50">
                {describing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {describing ? "Writing…" : description ? "Rewrite with AI" : "Write with AI"}
              </button>
            </div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={description ? 5 : 2}
              placeholder="Optional — tap “Write with AI” or type your own. Left blank, a basic one is used."
              className="w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm leading-snug outline-none focus:border-flag" />
          </div>

          <button onClick={list} disabled={busy || (format === "fixed" ? !price : !startBid)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-flag py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
            {busy ? "Publishing…" : format === "fixed" ? "List now (Buy It Now)" : `Start ${days}-day auction`}
          </button>
          <p className="text-[10px] leading-snug text-ink/35">
            {title.length}/80 title · uses the card&apos;s stored photos · your Seller Hub shipping/payment/return policies apply.
            {format === "auction" ? " Auctions can't be revised once bids arrive — double-check the start bid." : ""}
          </p>
        </div>
      )}
      {err && <p className="mt-2 text-xs leading-snug text-danger">{err}</p>}
    </section>
  );
}
