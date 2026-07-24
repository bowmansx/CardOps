import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { PostToLedger } from "@/components/cards/PostToLedger";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

// Business Books (Beau, 2026-07-20) — the FIRST bridge between CardOps and a
// business's ledger. Read-only + side-effect-free: per business ENTITY, it shows
// card inventory as a balance-sheet ASSET (at cost basis, with market value as an
// unrealized memo) and the realized card P&L for a period. Nothing posts anywhere
// yet — this proves the model before the internal-ledger and (gated) Zoho phases.
// See reference/cardops-accounting-and-advisor.md.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

type Entity = { id: string; name: string; short_code: string; zoho_books_org_id: string | null };

type Agg = {
  entity: Entity | null;
  invCount: number;
  invMarket: number;     // Σ manual_price ?? market_value (unrealized memo)
  invBasisPooled: number; // pool total_cost for this entity's pool(s)
  invBasisIndiv: number;  // Σ individual_basis for non-pooled live cards
  // Realized results split by tax line — these are DIFFERENT categories and are
  // never summed into one "profit" without a label.
  dealerIncome: number; dealerCount: number;   // ordinary business income (net−basis)
  capGain: number; capCount: number;           // capital gain/loss (net−basis)
  hobbyIncome: number; hobbyCount: number;      // hobby income (receipts−basis; costs not deductible)
  saleCount: number;
  intercoAdvance: number; // net receivable from affiliates (advanced out)
  intercoPayable: number; // net payable to affiliates (advanced in)
};

const UNASSIGNED = "—unassigned—";

function blank(entity: Entity | null): Agg {
  return {
    entity, invCount: 0, invMarket: 0, invBasisPooled: 0, invBasisIndiv: 0,
    dealerIncome: 0, dealerCount: 0, capGain: 0, capCount: 0, hobbyIncome: 0, hobbyCount: 0, saleCount: 0,
    intercoAdvance: 0, intercoPayable: 0,
  };
}

export default async function BooksPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Business financials are owner-only (entities are owner-gated by RLS).
  if ((await currentRole()) !== "owner") redirect("/cards");

  const thisYear = new Date().getFullYear();
  const yParam = Number((await searchParams).year);
  const year = Number.isFinite(yParam) && yParam >= 2000 && yParam <= thisYear + 1 ? yParam : thisYear;

  // Every figure on this page is a SUM over these two reads, so both must be
  // complete. `.limit(20000)` is capped at 1000 by PostgREST, which quietly made
  // inventory value, cost basis and YTD P/L partial. (2026-07-24)
  const [{ data: ents }, { data: pools }, cardsPage, salesPage, { count: journalCount }] = await Promise.all([
    supabase.from("card_businesses").select("id, name, short_code, zoho_books_org_id").order("short_code"),
    supabase.from("card_pool").select("entity_id, total_cost, card_count"),
    readAllSafe<Record<string, unknown>>((from, to) =>
      supabase
        .from("cards")
        .select("id, entity_id, use_pool_basis, individual_basis, market_value, manual_price, tax_treatment")
        .not("status", "in", "(archived,sold)")
        .order("id", { ascending: true })
        .range(from, to)),
    readAllSafe<Record<string, unknown>>((from, to) =>
      supabase
        .from("card_sales")
        .select("id, sale_price, fees, shipping_income, shipping_cost, basis_drawn, profit_loss, sold_at, cards ( entity_id, tax_treatment )")
        .gte("sold_at", `${year}-01-01`)
        .lt("sold_at", `${year + 1}-01-01`)
        .order("id", { ascending: true })
        .range(from, to)),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }),
  ]);
  const cards = cardsPage.rows;
  const sales = salesPage.rows;
  const totalsPartial = !!(cardsPage.error || salesPage.error);

  const entityById = new Map<string, Entity>((ents ?? []).map((e) => [e.id as string, e as Entity]));
  const aggs = new Map<string, Agg>();
  const get = (entityId: string | null) => {
    const key = entityId ?? UNASSIGNED;
    if (!aggs.has(key)) aggs.set(key, blank(entityId ? entityById.get(entityId) ?? null : null));
    return aggs.get(key)!;
  };

  // Inventory (assets): pooled basis from card_pool, individual basis + market from live cards.
  for (const p of pools ?? []) {
    const a = get((p.entity_id as string) ?? null);
    a.invBasisPooled += Number(p.total_cost ?? 0);
  }
  const treatmentTally: Record<string, number> = { dealer: 0, investment: 0, hobby: 0 };
  for (const c of cards) {
    const a = get((c.entity_id as string) ?? null);
    a.invCount += 1;
    a.invMarket += Number((c.manual_price ?? c.market_value) ?? 0);
    if (!c.use_pool_basis) a.invBasisIndiv += Number(c.individual_basis ?? 0);
    const t = (c.tax_treatment as string) ?? "dealer";
    if (t in treatmentTally) treatmentTally[t] += 1;
  }

  // Realized results for the year, bucketed by the card's tax treatment (a mixed
  // pile books to three different tax lines — kept separate here).
  for (const s of sales) {
    const card = (Array.isArray(s.cards) ? s.cards[0] : s.cards) as { entity_id: string | null; tax_treatment: string | null } | null;
    const a = get(card?.entity_id ?? null);
    const basis = Number(s.basis_drawn ?? 0);
    const profit = Number(s.profit_loss ?? 0); // net − basis
    const receipts = Number(s.sale_price ?? 0) + Number(s.shipping_income ?? 0);
    a.saleCount += 1;
    switch (card?.tax_treatment) {
      case "investment":
        a.capGain += profit; a.capCount += 1; break;
      case "hobby":
        a.hobbyIncome += receipts - basis; a.hobbyCount += 1; break; // costs NOT deducted
      default:
        a.dealerIncome += profit; a.dealerCount += 1; break;
    }
  }

  // Intercompany balances from the journal — an advance creates a receivable on
  // the payer (debit-normal asset) and a payable on the payee (credit-normal).
  const { rows: intercoRows } = await readAllSafe<Record<string, unknown>>((from, to) =>
    supabase
      .from("journal_entries").select("id, entity_id, account, debit, credit")
      .in("account", ["intercompany_advance", "intercompany_payable"])
      .order("id", { ascending: true }).range(from, to));
  for (const r of intercoRows) {
    const a = get((r.entity_id as string) ?? null);
    const net = Number(r.debit ?? 0) - Number(r.credit ?? 0);
    if (r.account === "intercompany_advance") a.intercoAdvance += net;
    else a.intercoPayable += -net;
  }

  const realized = (a: Agg) => a.dealerIncome + a.capGain + a.hobbyIncome;
  const rows = [...aggs.values()]
    .filter((a) => a.invCount > 0 || a.saleCount > 0 || Math.abs(a.intercoAdvance) > 0.005 || Math.abs(a.intercoPayable) > 0.005)
    .sort((x, y) => (y.invBasisPooled + y.invBasisIndiv + realized(y)) - (x.invBasisPooled + x.invBasisIndiv + realized(x)));

  const totalAssetBasis = rows.reduce((n, a) => n + a.invBasisPooled + a.invBasisIndiv, 0);
  const totalMarket = rows.reduce((n, a) => n + a.invMarket, 0);
  const totalRealized = rows.reduce((n, a) => n + realized(a), 0);

  const years = Array.from({ length: 4 }, (_, i) => thisYear - i);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Business Books</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/books/simulator" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Simulator</Link>
            {/* Tax advisor is single-homed on MasterOps (reads the shared Supabase) — stays there after cutover. */}
            <a href="https://master-ops-iota.vercel.app/tax" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Tax advisor</a>
            <Link href="/cards" className="text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] leading-snug text-ink/50">
          How your cards land on each business&apos;s books: inventory as a balance-sheet asset (at cost) and realized card
          P&amp;L. Read-only for now — posting to Zoho is the next, gated step.
        </p>

        {totalsPartial && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2.5 text-[11px] leading-snug text-danger">
            <b>Some records couldn&apos;t be read</b>, so the totals below are incomplete. Reload before relying
            on any figure here.
          </div>
        )}

        <div className="mt-3 flex gap-1.5">
          {years.map((y) => (
            <Link key={y} href={`/cards/books?year=${y}`}
              className={"rounded-full border px-3 py-1 text-xs font-semibold " + (y === year ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60")}>
              {y}
            </Link>
          ))}
        </div>

        {/* Consolidated top line */}
        <div className="mt-3 grid grid-cols-3 divide-x divide-hairline overflow-hidden rounded-xl border border-hairline bg-white">
          <div className="px-3 py-2.5">
            <div className="figures text-lg font-bold text-ink">{money(totalAssetBasis)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink/50">Inventory · at cost</div>
          </div>
          <div className="px-3 py-2.5">
            <div className="figures text-lg font-bold text-ink">{money(totalMarket)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink/50">Market value</div>
          </div>
          <div className="px-3 py-2.5">
            <div className={"figures text-lg font-bold " + (totalRealized >= 0 ? "text-pos" : "text-danger")}>{money(totalRealized)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink/50">{year} realized</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-hairline bg-white px-3 py-2 text-[11px] text-ink/55">
          <span className="font-semibold uppercase tracking-wider text-ink/40">Tax treatment</span>
          <span className="figures">{treatmentTally.dealer} dealer</span>
          <span className="text-ink/25">·</span>
          <span className="figures">{treatmentTally.investment} investment</span>
          <span className="text-ink/25">·</span>
          <span className="figures">{treatmentTally.hobby} hobby</span>
          <span className="ml-auto text-[10px] text-ink/35">set at intake or in bulk</span>
        </div>

        <PostToLedger entryCount={journalCount ?? 0} />
        <div className="mt-2 text-right">
          <a href={`/api/cards/books/journal?year=${year}`} className="text-[11px] font-semibold text-flag underline-offset-4 hover:underline">
            Export {year} ledger (CSV) — imports to Zoho / QuickBooks / anything →
          </a>
        </div>
        <div className="mt-1 text-right">
          <Link href="/cards/books/push-preview" className="text-[11px] font-semibold text-flag underline-offset-4 hover:underline">
            Preview the Zoho push (dry run) →
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-sm text-ink/45">No card inventory or sales to book yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {rows.map((a) => {
              const basis = a.invBasisPooled + a.invBasisIndiv;
              const unrealized = a.invMarket - basis;
              const name = a.entity ? `${a.entity.short_code} · ${a.entity.name}` : "Unassigned to a business";
              return (
                <div key={a.entity?.id ?? UNASSIGNED} className="overflow-hidden rounded-xl border border-hairline bg-white">
                  <div className="flex items-center justify-between border-b border-hairline bg-paper/50 px-3 py-2">
                    <span className="text-sm font-bold text-ink">{name}</span>
                    {a.entity && !a.entity.zoho_books_org_id && (
                      <span className="text-[10px] text-ink/40" title="No Zoho Books org linked to this entity yet">no Books org</span>
                    )}
                  </div>
                  {/* Balance-sheet asset */}
                  <div className="px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Assets — card inventory</div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
                      <div><div className="figures font-bold text-ink">{money2(basis)}</div><div className="text-[10px] text-ink/50">at cost · {a.invCount}</div></div>
                      <div><div className="figures font-bold text-ink">{money2(a.invMarket)}</div><div className="text-[10px] text-ink/50">market</div></div>
                      <div><div className={"figures font-bold " + (unrealized >= 0 ? "text-pos" : "text-danger")}>{money2(unrealized)}</div><div className="text-[10px] text-ink/50">unrealized</div></div>
                    </div>
                  </div>
                  {/* Realized results — split by tax line (mixed pile). */}
                  <div className="border-t border-hairline px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{year} realized · {a.saleCount} sale{a.saleCount === 1 ? "" : "s"}</div>
                    {a.saleCount === 0 ? (
                      <div className="mt-1 text-[11px] text-ink/40">No sales this year.</div>
                    ) : (
                      <div className="figures mt-1 space-y-0.5 text-[12px]">
                        {a.dealerCount > 0 && <TreatLine label="Ordinary income · dealer" count={a.dealerCount} value={a.dealerIncome} />}
                        {a.capCount > 0 && <TreatLine label="Capital gain/loss · investment" count={a.capCount} value={a.capGain} />}
                        {a.hobbyCount > 0 && <TreatLine label="Hobby income · hobby" count={a.hobbyCount} value={a.hobbyIncome} />}
                        <div className="mt-1 flex items-center justify-between border-t border-hairline pt-1 font-bold">
                          <span>Total realized</span>
                          <span className={realized(a) >= 0 ? "text-pos" : "text-danger"}>{money2(realized(a))}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  {(Math.abs(a.intercoAdvance) > 0.005 || Math.abs(a.intercoPayable) > 0.005) && (
                    <div className="flex flex-wrap items-center gap-x-3 border-t border-hairline px-3 py-2 text-[11px] text-ink/60">
                      <span className="font-semibold uppercase tracking-wider text-ink/40">Intercompany</span>
                      {Math.abs(a.intercoAdvance) > 0.005 && <span className="figures">advanced out {money2(a.intercoAdvance)}</span>}
                      {Math.abs(a.intercoPayable) > 0.005 && <span className="figures">owed to affiliates {money2(a.intercoPayable)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-5 text-[11px] leading-snug text-ink/40">
          Realized results are split by tax line (ordinary / capital / hobby). The internal journal + CSV export are
          backend-agnostic — they import into Zoho, QuickBooks, or Xero. The live API push is the last step, gated on
          your entity decision.
        </p>
      </div>
    </main>
  );
}

function TreatLine({ label, count, value }: { label: string; count: number; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink/60">{label} <span className="text-ink/35">· {count}</span></span>
      <span className={value >= 0 ? "text-pos" : "text-danger"}>{value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}</span>
    </div>
  );
}
