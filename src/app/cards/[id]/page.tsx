import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CardEstimates } from "@/components/cards/CardEstimates";
import { STATUS_TONE, type Card } from "@/lib/cards/types";
import { archiveCard } from "../actions";
import { GradeEstimate } from "@/components/cards/GradeEstimate";
import { GradeEV } from "@/components/cards/GradeEV";
import { AlertControl } from "@/components/cards/AlertControl";
import { PriceSparkline } from "@/components/cards/PriceSparkline";
import { SalesHistoryChart } from "@/components/cards/SalesHistoryChart";
import { parseStoredEstimate } from "@/lib/cards/grade-estimate-schema";
import { CardIntel } from "@/components/cards/CardIntel";
import { parseStoredIntel } from "@/lib/cards/card-intel-schema";
import { EbayListPanel } from "@/components/cards/EbayListPanel";
import { CardStatusControl } from "@/components/cards/CardStatusControl";
import { CardBooksControl } from "@/components/cards/CardBooksControl";
import { BasisBreakdown } from "@/components/cards/BasisBreakdown";
import { AddPhotos } from "@/components/cards/AddPhotos";
import { lotAverages, cardAcquisitionBasis } from "@/lib/cards/basis";
import { MarketBySource } from "@/components/cards/MarketBySource";
import { currentRole } from "@/lib/cards/roles";
import { suggestedListPrice } from "@/lib/cards/valuation";
import { sourceAvailability, type CardForPricing } from "@/lib/cards/price-sources";

export const dynamic = "force-dynamic";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default async function CardDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("cards").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Card;
  const role = await currentRole();
  // Acquisition half of the basis: the lot's CURRENT average, or the stated
  // figure. The cost lines that sit on top are loaded by the breakdown itself.
  const { data: lotRow } = c.purchase_lot_id
    ? await supabase.from("purchase_lots").select("id, remaining_cost, remaining_count").eq("id", c.purchase_lot_id).maybeSingle()
    : { data: null };
  const acquisition = cardAcquisitionBasis(
    c as unknown as { purchase_lot_id: string | null; individual_basis: number | null },
    lotAverages(lotRow ? [lotRow as { id: string; remaining_cost: number | null; remaining_count: number | null }] : []),
  );
  // Each card user has their own businesses (RLS-scoped) — not owner-gated.
  const entities =
    (await supabase.from("card_businesses").select("id, short_code, name").eq("active", true).order("short_code")).data ?? [];
  const { data: alertRow } = await supabase
    .from("card_alerts").select("kind, target_price, direction, threshold_pct, window_days, note").eq("card_id", id).maybeSingle();
  const { data: priceHist } = await supabase
    .from("card_price_history").select("price, ts").eq("card_id", id).order("ts", { ascending: true }).limit(200);
  const { data: mktSales } = await supabase
    // Shared identity history when we can fingerprint the card, so the chart
    // shows every sale anyone has collected for it — not just the ones observed
    // since this copy was added.
    .from("card_market_sales").select("sold_at, price, grader, grade").eq("pre_auto_split", false)
    .eq(c.identity_id ? "identity_id" : "card_id", c.identity_id ?? id)
    .order("sold_at", { ascending: true }).limit(500);
  const { data: srcQuotes } = await supabase
    .from("card_source_quotes")
    .select("source, kind, grader, grade, price, currency, label, url, fetched_at")
    .eq("card_id", id).order("source").order("grade", { ascending: true, nullsFirst: true });

  // Cached AI estimates (newest per mode, one bounded query each) + credit balance
  // (SQL aggregate) + the AI switch.
  const EST_COLS = "mode, value, low, high, confidence, rationale, sources, credits_spent, model, created_at";
  const svc = createServiceClient();
  const [estStd, estAll, { data: bal, error: balErr }, { data: aiCfg }] = await Promise.all([
    supabase.from("card_estimates").select(EST_COLS).eq("card_id", id).eq("mode", "standard_plus").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("card_estimates").select(EST_COLS).eq("card_id", id).eq("mode", "all_sales_plus").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc("credit_balance"),
    svc ? svc.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const estimates: Record<string, unknown> = {};
  if (estStd.data) estimates.standard_plus = estStd.data;
  if (estAll.data) estimates.all_sales_plus = estAll.data;
  // null (not 0) when the balance can't be read — a money figure renders
  // complete or flagged, never 0-as-fact (rule 4).
  const creditBalance = balErr ? null : Number(bal ?? 0);
  const aiOn = !!aiCfg?.enabled;

  // Stored photos (private bucket → short-lived signed URLs).
  const { data: photos } = await supabase
    .from("card_photos").select("id, kind, role, bucket, path, variant, derived_from").eq("card_id", id).order("created_at");

  // Which template shots this card actually HAS. One shot can store two rows
  // (the uncropped frame and the crop derived from it), so counting rows would
  // report a 12-shot template as satisfied after six photos. A shot is a row
  // that nothing else was derived FROM.
  const sourceIds = new Set((photos ?? []).map((p) => p.derived_from).filter(Boolean) as string[]);
  const haveRoles = (photos ?? [])
    .filter((p) => !sourceIds.has(p.id as string))
    .map((p) => (p.role as string) ?? (p.kind as string));
  const shots = (
    await Promise.all(
      (photos ?? []).map(async (p) => {
        const { data: s } = await supabase.storage.from(p.bucket as string).createSignedUrl(p.path as string, 3600);
        return { kind: p.kind as string, url: s?.signedUrl };
      }),
    )
  ).filter((s): s is { kind: string; url: string } => !!s.url);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const cardUrl = `${proto}://${host}/cards/${c.id}`;
  const qr = await QRCode.toDataURL(cardUrl, { margin: 1, width: 220 });

  const title = [c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(untitled)";
  const rows: [string, string][] = [
    ["SKU", c.sku],
    ["Category", c.sport_category ?? "—"],
    ["Card #", c.card_number ?? "—"],
    ["Parallel", c.parallel ?? "—"],
    ["Team", c.team ?? "—"],
    ["Condition", c.condition_type === "graded" ? `${c.grader ?? ""} ${c.grade ?? ""}${c.cert_number ? ` · cert ${c.cert_number}` : ""}` : "Raw"],
    ["Acquisition", c.purchase_lot_id ? `Purchase lot ${money(acquisition)}` : money(c.individual_basis)],
    ["Market value", money(c.market_value)],
    ["Manual price", money(c.manual_price)],
    ["Strategy", c.pricing_strategy],
    ["Zone", c.zone ?? "—"],
    ["Location", c.location_code ?? "—"],
    ["Acquisition", c.acquisition_method ?? "—"],
  ];

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          <span className="flex items-center gap-3">
            {c.status !== "sold" && (
              <Link href={`/cards/${c.id}/sell`} className="text-xs font-semibold text-pos underline-offset-4 hover:underline">Sell</Link>
            )}
            <Link href={`/cards/${c.id}/value`} className="text-xs font-semibold text-flag underline-offset-4 hover:underline">Value</Link>
            <Link href={`/cards/${c.id}/label`} className="text-xs font-semibold text-flag underline-offset-4 hover:underline">Label</Link>
            <Link href={`/cards/${c.id}/edit`} className="text-xs font-semibold text-flag underline-offset-4 hover:underline">Edit</Link>
          </span>
        </header>

        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight">{title}</h1>
            <span className={"mt-2 inline-block rounded px-2 py-0.5 text-[11px] font-semibold " + (STATUS_TONE[c.status] ?? "bg-ink/10")}>{c.status}</span>
          </div>
          <div className="shrink-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR" className="h-24 w-24 rounded border border-hairline bg-white" />
            <div className="figures mt-1 text-[10px] text-ink/40">scan → card</div>
          </div>
        </div>

        {/* Photograph the card against a template — and the way back for a
            card that was booked without its photos. */}
        <AddPhotos cardId={c.id} haveRoles={haveRoles} />

        {/* Total Cost Basis, expandable into the lines that make it up. */}
        <div className="mt-4">
          <BasisBreakdown
            cardId={c.id}
            acquisition={acquisition}
            fromLot={!!c.purchase_lot_id}
            basisEntered={(c as unknown as { basis_entered?: boolean | null }).basis_entered !== false}
            sold={c.status === "sold"}
          />
        </div>

        {/* THE PRICE BLOCK (Beau, 2026-07-19): the money answer belongs on
            the card page, not buried in a rows table or another screen. */}
        {(() => {
          const cur = (c.manual_price ?? c.market_value ?? null) as number | null;
          if (cur == null) {
            return (
              <Link href={`/cards/${c.id}/value`}
                className="mt-4 block rounded-xl border border-warn/40 bg-warn/10 px-4 py-3">
                <div className="text-sm font-bold text-warn">No sales evidence yet — this card has no value data.</div>
                <div className="mt-0.5 text-[11px] leading-snug text-ink/60">
                  Tap here → paste a few sales from Card Ladder / eBay solds (or add comps) and every number lights up:
                  market value, grade ladder, if-graded prices, timelines.
                </div>
              </Link>
            );
          }
          const cRec = c as unknown as Record<string, unknown>;
          const list = suggestedListPrice(cur, (cRec.landed_cost as number | null) ?? null);
          const dcell = (then: unknown, tag: string) => {
            const t = then == null ? null : Number(then);
            if (t == null || !(t > 0)) return <div className="figures text-sm font-semibold text-ink/30">—</div>;
            const d = ((cur - t) / t) * 100;
            return (
              <div className={"figures text-sm font-bold " + (Math.abs(d) < 0.5 ? "text-ink/50" : d > 0 ? "text-pos" : "text-danger")}>
                {d > 0 ? "+" : ""}{d.toFixed(0)}%
                <span className="ml-1 text-[9px] font-semibold text-ink/35">{tag}</span>
              </div>
            );
          };
          return (
            <div className="mt-4 rounded-xl border border-hairline bg-white px-4 py-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink/50">{c.manual_price != null ? "Your price" : "Market value"}</div>
                  <div className="figures text-2xl font-bold text-flag">{money(cur)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-ink/50">{list.floorApplied ? "List · floor" : "Suggested list"}</div>
                  <div className="figures text-lg font-bold text-ink">{money(list.price)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-ink/50">vs 30d · 1y</div>
                  <div className="flex items-center justify-end gap-2">
                    {dcell(cRec.value_30d, "30d")}
                    {dcell(cRec.value_365d, "1y")}
                  </div>
                </div>
              </div>
              {/* Price trend sparkline (daily market value) + accumulated sales history. */}
              <PriceSparkline points={(priceHist ?? []) as { price: number; ts: string }[]} className="mt-2" />
              {(mktSales?.length ?? 0) >= 2 && (
                <div className="mt-3 border-t border-hairline pt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Sales over time · what we&apos;ve banked</div>
                  <SalesHistoryChart sales={(mktSales ?? []) as { sold_at: string | null; price: number; grader: string | null; grade: number | null }[]} />
                </div>
              )}
              <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
                <span className="figures text-[10px] text-ink/45">
                  format: {c.pricing_strategy}{cRec.raw_grade_estimate ? ` · ${String(cRec.raw_grade_estimate)}` : ""}
                </span>
                <Link href={`/cards/${c.id}/value`} className="text-[11px] font-bold text-flag underline-offset-2 hover:underline">
                  Full value lab →
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Market — by source: each vendor separately + a blended consensus. */}
        <MarketBySource
          cardId={c.id}
          card={{ condition_type: c.condition_type, grader: c.grader ?? null, grade: c.grade ?? null }}
          compValue={(c.manual_price ?? c.market_value ?? null) as number | null}
          initialQuotes={(srcQuotes ?? []) as never}
          initialAvailable={sourceAvailability({
            id: c.id, player: c.player ?? null, year: c.year ?? null, set_name: c.set_name ?? null,
            card_number: c.card_number ?? null, parallel: c.parallel ?? null,
            sport_category: c.sport_category ?? null, grader: c.grader ?? null,
            grade: c.grade ?? null, condition_type: c.condition_type,
          } as CardForPricing)}
        />

        {/* CardOps Estimated Price — A (standard+context) and B (all-sales+context). */}
        <CardEstimates cardId={c.id} aiOn={aiOn} initial={estimates as never} initialBalance={creditBalance} />

        {shots.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {shots.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.kind} className="h-40 w-auto rounded-lg border border-hairline bg-white object-contain" />
                <div className="figures mt-0.5 text-center text-[10px] text-ink/40">{s.kind}</div>
              </a>
            ))}
          </div>
        )}

        {shots.length > 0 && (
          <GradeEstimate
            cardId={c.id}
            initial={parseStoredEstimate((data as { vision_confidence?: { grade_estimate?: unknown } }).vision_confidence?.grade_estimate)}
          />
        )}

        {/* Grade-or-Flip EV — raw cards only (the profit-max grading decision). */}
        {c.condition_type !== "graded" && <GradeEV cardId={c.id} />}

        <AlertControl
          cardId={c.id}
          marketValue={(c.manual_price ?? c.market_value ?? null) as number | null}
          initial={(alertRow as { kind?: string; target_price: number | null; direction: string; threshold_pct?: number | null; window_days?: number | null; note: string | null } | null) ?? null}
        />

        {(() => {
          const vc = (data as { vision_confidence?: { intel?: unknown; intel_by?: Record<string, unknown> } }).vision_confidence;
          const by = vc?.intel_by ?? {};
          const legacy = parseStoredIntel(vc?.intel);
          const slot = (h: string) => parseStoredIntel(by[h]) ?? (legacy && (legacy.horizon ?? "season") === h ? legacy : null);
          return (
            <CardIntel
              cardId={c.id}
              initial={{ flip: slot("flip"), season: slot("season"), longterm: slot("longterm") }}
            />
          );
        })()}

        {/* List on eBay — owner, unsold, on the MasterOps domain (the eBay
            routes + env are single-homed there; the standalone app links over). */}
        {c.status !== "sold" && role === "owner" && (
          (host.startsWith("card-ops")) ? (
            <a href={`https://master-ops-iota.vercel.app/cards/${c.id}`}
              className="mt-4 block rounded-xl border border-hairline bg-white px-3 py-2.5 text-center text-xs font-semibold text-flag">
              List on eBay from MasterOps →
            </a>
          ) : (
            <EbayListPanel
              cardId={c.id}
              defaultTitle={[c.year, c.player, c.set_name, c.parallel, c.card_number ? `#${c.card_number}` : null,
                c.condition_type === "graded" ? `${c.grader} ${c.grade}` : null].filter(Boolean).join(" ").slice(0, 80)}
              suggestedPrice={(c.manual_price ?? c.market_value ?? null) as number | null}
              marketValue={(c.market_value ?? null) as number | null}
              listed={((data as { listing_refs?: { ebay?: { url?: string; listing_id?: string; status?: string } } }).listing_refs?.ebay) ?? null}
            />
          )
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-hairline px-3 py-2 last:border-b-0">
              <span className="text-[11px] uppercase tracking-wider text-ink/50">{k}</span>
              <span className="figures text-right text-sm font-medium text-ink">{v}</span>
            </div>
          ))}
        </div>

        {c.notes && <p className="mt-3 rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink/70">{c.notes}</p>}

        {/* Owner: change status inline, or reverse a mistaken/cancelled sale. */}
        {role === "owner" && (
          <CardBooksControl
            cardId={c.id}
            treatment={(c as { tax_treatment?: string }).tax_treatment ?? "dealer"}
            entityId={(c as { entity_id?: string | null }).entity_id ?? null}
            entities={entities as { id: string; short_code: string; name: string }[]}
          />
        )}
        {role === "owner" && <CardStatusControl cardId={c.id} status={c.status} />}

        {c.status !== "archived" && c.status !== "sold" && (
          <form action={archiveCard.bind(null, c.id)} className="mt-5">
            <button className="w-full rounded-xl border border-danger/30 py-2.5 text-sm font-semibold text-danger/80 transition hover:bg-danger/10">
              Archive card
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
