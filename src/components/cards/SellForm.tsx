"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { sellCard, type SellResult } from "@/app/cards/[id]/sell/actions";

const inp = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag";
const lbl = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50";
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px] leading-snug text-ink/35">{children}</p>;
}

// Fee presets (approximate, 2026 — always editable; platforms change fees).
const FEES: Record<string, { pct: number; fixed: number; note: string }> = {
  ebay: { pct: 13.25, fixed: 0.4, note: "eBay trading cards ≈ 13.25% + $0.40" },
  whatnot: { pct: 10.9, fixed: 0.3, note: "Whatnot ≈ 8% + ~2.9% + $0.30 processing" },
  tcgplayer: { pct: 12.75, fixed: 0.3, note: "TCGplayer ≈ 10.25% + 2.5% + $0.30" },
  mercari: { pct: 12.9, fixed: 0.5, note: "Mercari ≈ 10% + processing" },
  comc: { pct: 5, fixed: 0, note: "COMC ≈ 5% cash-out (storage fees separate)" },
  square: { pct: 2.9, fixed: 0.3, note: "Square ≈ 2.9% + $0.30" },
  shop: { pct: 2.9, fixed: 0.3, note: "Own shop ≈ card processing 2.9% + $0.30" },
  other: { pct: 0, fixed: 0, note: "No preset — enter fees yourself" },
};
const PLATFORMS = Object.keys(FEES);
// Platforms where a listing (title + description) exists worth keeping.
const LISTING_PLATFORMS = new Set(["ebay", "whatnot", "tcgplayer", "mercari"]);

// Card-world shipping estimates (editable; tweak to your actuals).
const SHIPPING: { key: string; label: string; cost: number | null }[] = [
  { key: "", label: "— pick a method (fills the cost) —", cost: null },
  { key: "ese", label: "eBay Standard Envelope (raw card < $20)", cost: 0.83 },
  { key: "pwe", label: "Plain white envelope + stamp", cost: 0.73 },
  { key: "bmt", label: "Bubble mailer + tracking (Ground Advantage)", cost: 5.25 },
  { key: "slab", label: "Graded slab box + tracking", cost: 5.75 },
  { key: "free", label: "Free shipping (cost baked into price)", cost: 0 },
];

export function SellForm({
  id,
  cardTitle,
  suggestedPrice = null,
  graded = null,
}: {
  id: string;
  cardTitle: string;
  suggestedPrice?: number | null;
  graded?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<SellResult, { ok: true }> | null>(null);
  const [f, setF] = useState({
    platform: "ebay",
    sale_price: suggestedPrice != null ? String(suggestedPrice) : "",
    fees: "",
    shipping_income: "",
    shipping_cost: "",
    order_ref: "",
    listing_title: graded ? `${cardTitle} ${graded}` : cardTitle,
    listing_desc: "",
  });
  const [feesTouched, setFeesTouched] = useState(false);
  const [shipMethod, setShipMethod] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

  // Auto-fee: platform preset × price, DERIVED during render until the user
  // edits fees themselves (feesTouched). Deriving (instead of the old
  // setState-in-effect) means it can never lag a render behind the price and
  // clears itself when it no longer applies.
  const feePreset = FEES[f.platform] ?? FEES.other;
  const feeBase = num(f.sale_price);
  const autoFeeApplies = feeBase > 0 && feePreset.pct + feePreset.fixed > 0;
  const fees = feesTouched ? f.fees : autoFeeApplies ? (feeBase * (feePreset.pct / 100) + feePreset.fixed).toFixed(2) : "";

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
    const res = await sellCard(id, {
      platform: f.platform,
      sale_price: num(f.sale_price),
      fees: num(fees),
      shipping_income: num(f.shipping_income),
      shipping_cost: num(f.shipping_cost),
      order_ref: f.order_ref.trim() || null,
      listing: LISTING_PLATFORMS.has(f.platform)
        ? { title: f.listing_title.trim() || null, description: f.listing_desc.trim() || null }
        : null,
    });
    if (!res.ok) { setErr(res.error); return; }
    setDone(res);
    } catch (e) {
      // Rule 8: a money state machine may not dead-end. A rejection here used
      // to freeze the button, leaving you unable to tell whether the sale
      // recorded. Say plainly that it did not, and check before retrying.
      setErr(
        (e instanceof Error && e.message ? e.message + " — " : "") +
        "The sale was not recorded. Check the card before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const win = done.profit_loss >= 0;
    return (
      <div className="mt-8 rounded-2xl border border-pos/30 bg-pos/5 p-6 text-center">
        <CheckCircle2 size={40} className="mx-auto text-pos" />
        <p className="mt-3 font-bold text-ink">Sold &amp; settled.</p>
        <div className="figures mx-auto mt-4 max-w-xs space-y-1 text-sm">
          <Row k="Net proceeds" v={money(done.net)} />
          <Row k="Basis drawn" v={money(done.basis)} />
          <div className={"flex justify-between border-t border-hairline pt-1 font-bold " + (win ? "text-pos" : "text-danger")}>
            <span>Profit / loss</span><span>{money(done.profit_loss)}</span>
          </div>
        </div>
        <Link href={`/cards/${id}`} className="mt-5 inline-block rounded-xl bg-flag px-5 py-3 font-bold text-white active:scale-95">Back to card</Link>
      </div>
    );
  }

  const preset = FEES[f.platform] ?? FEES.other;

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-hairline bg-white p-4">
      <p className="figures text-sm text-ink/60">{cardTitle}{graded ? ` · ${graded}` : ""}</p>

      <label className="block">
        <span className={lbl}>Platform</span>
        <select
          value={f.platform}
          onChange={(e) => { set("platform", e.target.value); setFeesTouched(false); }}
          className={inp}
        >
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Hint>
          Sales are RECORDED here — platform accounts aren&apos;t linked yet (a future connector).
          List on the platform as usual, then settle it here.
        </Hint>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={lbl}>Sale price $</span>
          <input type="number" step="0.01" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} className={inp + " figures"} />
          {suggestedPrice != null && <Hint>Prefilled from the card&apos;s current value ({money(suggestedPrice)}) — change to the actual sale.</Hint>}
        </label>
        <label className="block">
          <span className={lbl}>Fees $</span>
          <input
            type="number" step="0.01" value={fees}
            onChange={(e) => { setFeesTouched(true); set("fees", e.target.value); }}
            className={inp + " figures"}
          />
          <Hint>Auto: {preset.note}. Edit freely — your number wins.</Hint>
        </label>
        <label className="block">
          <span className={lbl}>Shipping charged $</span>
          <input type="number" step="0.01" value={f.shipping_income} onChange={(e) => set("shipping_income", e.target.value)} className={inp + " figures"} />
          <Hint>What the BUYER paid you for shipping (0 if free shipping).</Hint>
        </label>
        <label className="block">
          <span className={lbl}>Shipping cost $</span>
          <select
            value={shipMethod}
            onChange={(e) => {
              setShipMethod(e.target.value);
              const m = SHIPPING.find((s) => s.key === e.target.value);
              if (m?.cost != null) set("shipping_cost", String(m.cost));
            }}
            className={inp + " mb-1.5"}
          >
            {SHIPPING.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input type="number" step="0.01" value={f.shipping_cost} onChange={(e) => set("shipping_cost", e.target.value)} className={inp + " figures"} />
          <Hint>Pick a method for a typical estimate, then tweak to the actual label cost.</Hint>
        </label>
      </div>

      {LISTING_PLATFORMS.has(f.platform) && (
        <div className="space-y-2 rounded-xl border border-hairline bg-paper/60 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
            {f.platform} listing details (optional — saved with the card)
          </div>
          <label className="block">
            <span className={lbl}>Listing title</span>
            <input value={f.listing_title} onChange={(e) => set("listing_title", e.target.value)} className={inp} />
            <Hint>Prefilled from the card — paste-ready for the platform&apos;s title box.</Hint>
          </label>
          <label className="block">
            <span className={lbl}>Description</span>
            <textarea value={f.listing_desc} onChange={(e) => set("listing_desc", e.target.value)} rows={3} className={inp} placeholder="Condition notes, ship terms…" />
          </label>
        </div>
      )}

      <label className="block">
        <span className={lbl}>Order # / reference (optional)</span>
        <input value={f.order_ref} onChange={(e) => set("order_ref", e.target.value)} className={inp} placeholder="e.g. eBay order 12-34567-89012" />
        <Hint>The platform&apos;s order number — so this sale can be matched to the platform later. Your own tag works too.</Hint>
      </label>

      {err && <p className="text-xs text-danger">{err}</p>}
      <button onClick={submit} disabled={busy || f.sale_price.trim() === ""} className="flex w-full items-center justify-center gap-2 rounded-xl bg-flag py-3 font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" /> : null} Settle sale
      </button>
      <p className="text-[11px] text-ink/40">Records the sale, draws basis from the pool (pooled cards), computes P/L, and marks the card sold — all atomically.</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-ink/70"><span>{k}</span><span>{v}</span></div>;
}
