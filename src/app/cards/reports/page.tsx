import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { readAllSafe } from "@/lib/supabase/page";
import { lotAverages, cardBasis } from "@/lib/cards/basis";

export const dynamic = "force-dynamic";

// Reports (owner-only money view). A view selector switches between report
// types; all realized numbers come from settled sales (card_sales), unrealized
// from live inventory. Bookkeeping aid, not tax advice.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const money0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type CardBits = { sport_category: string | null; player: string | null; set_name: string | null; listed_at: string | null };
type SaleRow = {
  platform: string; sale_price: number | null; fees: number | null;
  shipping_income: number | null; shipping_cost: number | null;
  net_proceeds: number | null; basis_drawn: number | null;
  profit_loss: number | null; sold_at: string;
  cards: CardBits | CardBits[] | null;
};
type OpenCard = {
  sport_category: string | null; status: string; condition_type: string | null;
  manual_price: number | null; market_value: number | null;
  purchase_lot_id: string | null; individual_basis: number | null; listed_at: string | null;
};

const num = (v: unknown) => Number(v ?? 0);
const sum = (rows: SaleRow[], k: keyof SaleRow) => rows.reduce((s, r) => s + num(r[k]), 0);
const cardOf = (r: SaleRow): CardBits | null => (Array.isArray(r.cards) ? r.cards[0] : r.cards) ?? null;


const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "monthly", label: "Monthly" },
  { key: "category", label: "By category" },
  { key: "velocity", label: "Velocity" },
  { key: "inventory", label: "Inventory" },
] as const;

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "pos" | "neg" }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className={"text-xs " + (strong ? "font-bold text-ink" : "text-ink/60")}>{label}</span>
      <span className={"figures text-sm " + (strong ? "font-bold " : "font-semibold ") + (tone === "pos" ? "text-pos" : tone === "neg" ? "text-danger" : "text-ink")}>{value}</span>
    </div>
  );
}
function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">{title}</h2>
        {right}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if ((await currentRole()) !== "owner") redirect("/cards");
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "overview";
  const supabase = await createClient();

  const [salesPage, openPage, lotsPage] = await Promise.all([
    readAllSafe<SaleRow>((from, to) => supabase.from("card_sales")
      .select("platform, sale_price, fees, shipping_income, shipping_cost, net_proceeds, basis_drawn, profit_loss, sold_at, cards ( sport_category, player, set_name, listed_at )")
      .order("sold_at", { ascending: false }).order("id", { ascending: true }).range(from, to)),
    readAllSafe<OpenCard>((from, to) => supabase.from("cards")
      .select("sport_category, status, condition_type, manual_price, market_value, purchase_lot_id, individual_basis, listed_at")
      .not("status", "in", "(sold,archived)").order("id", { ascending: true }).range(from, to)),
    readAllSafe<{ id: string; remaining_cost: number | null; remaining_count: number | null }>((from, to) =>
      supabase.from("purchase_lots").select("id, remaining_cost, remaining_count")
        .order("id", { ascending: true }).range(from, to)),
  ]);
  const sales = salesPage.rows;
  const open = openPage.rows;
  const partial = !!(salesPage.error || openPage.error || lotsPage.error);

  const tabHref = (v: string) => (v === "overview" ? "/cards/reports" : `/cards/reports?view=${v}`);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3">
            <Link href="/cards/sales" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">Sales</Link>
            <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>

        {partial && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2.5 text-[11px] leading-snug text-danger">
            <b>Some records couldn&apos;t be read</b> — every figure on this page is unreliable. Reload before relying on any of them.
          </div>
        )}
        {/* Report picker */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <Link key={v.key} href={tabHref(v.key)}
              className={"rounded-full border px-3 py-1 text-xs font-semibold " + (view === v.key ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60")}>
              {v.label}
            </Link>
          ))}
        </div>

        {view === "overview" && <Overview sales={sales} open={open} lots={lotsPage.rows} />}
        {view === "monthly" && <Monthly sales={sales} />}
        {view === "category" && <ByCategory sales={sales} />}
        {view === "velocity" && <Velocity sales={sales} open={open} />}
        {view === "inventory" && <Inventory open={open} />}
      </div>
    </main>
  );
}

// ── Overview: unrealized snapshot + realized per year (+ CSV) ─────────────────
function Overview({ sales, open, lots }: { sales: SaleRow[]; open: OpenCard[]; lots: { id: string; remaining_cost: number | null; remaining_count: number | null }[] }) {
  const unrealizedValue = open.reduce((s, c) => s + num(c.manual_price ?? c.market_value), 0);
  const avgByLot = lotAverages(lots);
  const individualBasis = open.reduce((s, c) => s + (c.purchase_lot_id ? 0 : num(c.individual_basis)), 0);
  const openPooledCount = open.filter((c) => c.purchase_lot_id).length;
  const openPoolBasis = Math.round(open.reduce((s, c) => s + (c.purchase_lot_id ? cardBasis(c, avgByLot) : 0), 0) * 100) / 100;
  const openBasis = openPoolBasis + individualBasis;
  const years = [...new Set(sales.map((s) => s.sold_at.slice(0, 4)))].sort().reverse();

  return (
    <>
      <Card title="On the shelf (unrealized)">
        <Line label={`Inventory value · ${open.length} cards`} value={money(unrealizedValue)} strong />
        <Line label={`Purchase-lot basis (${openPooledCount} lot cards)`} value={money(openPoolBasis)} />
        {individualBasis > 0 && <Line label="Individually-based cards basis" value={money(individualBasis)} />}
        <Line label="Unrealized gain if sold at value" value={money(unrealizedValue - openBasis)} tone={unrealizedValue - openBasis >= 0 ? "pos" : "neg"} />
      </Card>
      {years.length === 0 && <Empty text="No settled sales yet — sell something first. 🎯" />}
      {years.map((y) => {
        const rows = sales.filter((s) => s.sold_at.slice(0, 4) === y);
        const platforms = [...new Set(rows.map((r) => r.platform))].sort();
        const pl = sum(rows, "profit_loss");
        return (
          <Card key={y} title={y} right={<a href={`/api/cards/reports?year=${y}`} className="text-xs font-bold text-flag underline-offset-2 hover:underline">Download {y} CSV</a>}>
            <Line label={`Sales (${rows.length})`} value={money(sum(rows, "sale_price"))} strong />
            <Line label="Shipping collected" value={money(sum(rows, "shipping_income"))} />
            <Line label="Platform fees" value={`−${money(sum(rows, "fees"))}`} />
            <Line label="Shipping cost" value={`−${money(sum(rows, "shipping_cost"))}`} />
            <Line label="Net proceeds" value={money(sum(rows, "net_proceeds"))} strong />
            <Line label="Basis drawn" value={`−${money(sum(rows, "basis_drawn"))}`} />
            <Line label="Profit / loss" value={money(pl)} strong tone={pl >= 0 ? "pos" : "neg"} />
            {platforms.length > 1 && (
              <div className="mt-2 border-t border-hairline pt-2">
                {platforms.map((p) => {
                  const pr = rows.filter((r) => r.platform === p);
                  const ppl = sum(pr, "profit_loss");
                  return (
                    <div key={p} className="flex items-baseline justify-between py-0.5">
                      <span className="text-[11px] text-ink/50">{p} · {pr.length}</span>
                      <span className={"figures text-xs font-semibold " + (ppl >= 0 ? "text-pos" : "text-danger")}>{money(sum(pr, "sale_price"))} · P/L {money(ppl)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

// ── A generic grouped-P&L table (used by monthly & category) ─────────────────
function GroupTable({ sales, keyOf, title, sortKeys }: { sales: SaleRow[]; keyOf: (r: SaleRow) => string; title: string; sortKeys?: (a: string, b: string) => number }) {
  const groups = new Map<string, SaleRow[]>();
  for (const r of sales) {
    const k = keyOf(r);
    let arr = groups.get(k);
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(r);
  }
  const keys = [...groups.keys()].sort(sortKeys);
  if (!keys.length) return <Empty text="No settled sales in this cut yet." />;
  const maxRev = Math.max(1, ...keys.map((k) => sum(groups.get(k)!, "sale_price")));
  return (
    <Card title={title}>
      {keys.map((k) => {
        const rows = groups.get(k)!;
        const pl = sum(rows, "profit_loss");
        const rev = sum(rows, "sale_price");
        return (
          <div key={k} className="border-b border-hairline py-1.5 last:border-b-0">
            <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-ink/80">{k} <span className="text-ink/40">· {rows.length}</span></span>
            <span className="figures text-right text-xs">
              <span className="font-semibold text-ink">{money0(rev)}</span>
              <span className={"ml-2 font-bold " + (pl >= 0 ? "text-pos" : "text-danger")}>{pl >= 0 ? "+" : ""}{money0(pl)}</span>
            </span>
            </div>
            {/* Revenue bar (width ∝ revenue), tinted by profit/loss. */}
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-hairline/40">
              <div className={"h-full rounded-full " + (pl >= 0 ? "bg-pos" : "bg-danger")} style={{ width: `${Math.max(2, (rev / maxRev) * 100)}%` }} />
            </div>
          </div>
        );
      })}
      <p className="mt-2 text-[10px] text-ink/40">Bar = revenue (relative); color = profit/loss.</p>
    </Card>
  );
}
function Monthly({ sales }: { sales: SaleRow[] }) {
  return <GroupTable sales={sales} title="Profit / loss by month" keyOf={(r) => r.sold_at.slice(0, 7)} sortKeys={(a, b) => b.localeCompare(a)} />;
}
function ByCategory({ sales }: { sales: SaleRow[] }) {
  return <GroupTable sales={sales} title="Profit / loss by category" keyOf={(r) => cardOf(r)?.sport_category || "Uncategorized"} />;
}

// ── Velocity: days-to-sell + aged inventory ──────────────────────────────────
function Velocity({ sales, open }: { sales: SaleRow[]; open: OpenCard[] }) {
  const spans = sales.map((r) => {
    const li = cardOf(r)?.listed_at;
    if (!li) return null;
    const d = (new Date(r.sold_at).getTime() - new Date(li).getTime()) / 86_400_000;
    return d >= 0 ? d : null;
  }).filter((d): d is number => d != null);
  const avg = spans.length ? spans.reduce((s, d) => s + d, 0) / spans.length : null;
  const sorted = spans.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const listed = open.filter((c) => c.status === "listed");
  const now = Date.now();
  const aged = listed.filter((c) => c.listed_at && (now - new Date(c.listed_at).getTime()) / 86_400_000 > 60);
  const agedValue = aged.reduce((s, c) => s + num(c.manual_price ?? c.market_value), 0);

  return (
    <>
      <Card title="How fast things sell">
        <Line label={`Avg days to sell (${spans.length} tracked)`} value={avg == null ? "—" : `${avg.toFixed(1)} days`} strong />
        <Line label="Median days to sell" value={median == null ? "—" : `${median.toFixed(0)} days`} />
        <p className="mt-1 text-[10px] text-ink/40">From listed→sold on sales where a listed date was recorded.</p>
      </Card>
      <Card title="Aged inventory (listed > 60 days)">
        <Line label={`Stale listings`} value={String(aged.length)} strong tone={aged.length ? "neg" : undefined} />
        <Line label="Capital tied up in them" value={money0(agedValue)} tone={aged.length ? "neg" : undefined} />
        <p className="mt-1 text-[10px] text-ink/40">Candidates to reprice, offer to watchers, or lot up.</p>
      </Card>
    </>
  );
}

// ── Inventory composition ────────────────────────────────────────────────────
function Inventory({ open }: { open: OpenCard[] }) {
  const val = (c: OpenCard) => num(c.manual_price ?? c.market_value);
  const byCat = new Map<string, { n: number; v: number }>();
  const byStatus = new Map<string, { n: number; v: number }>();
  let graded = 0, raw = 0;
  for (const c of open) {
    const cat = c.sport_category || "Uncategorized";
    const cg = byCat.get(cat) ?? { n: 0, v: 0 }; cg.n++; cg.v += val(c); byCat.set(cat, cg);
    const sg = byStatus.get(c.status) ?? { n: 0, v: 0 }; sg.n++; sg.v += val(c); byStatus.set(c.status, sg);
    if (c.condition_type === "graded") graded++; else raw++;
  }
  const rows = (m: Map<string, { n: number; v: number }>) => {
    const entries = [...m.entries()].sort((a, b) => b[1].v - a[1].v);
    const maxV = Math.max(1, ...entries.map(([, g]) => g.v));
    return entries.map(([k, g]) => (
      <div key={k} className="py-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-ink/70">{k} <span className="text-ink/40">· {g.n}</span></span>
          <span className="figures text-sm font-semibold text-ink">{money0(g.v)}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-hairline/40">
          <div className="h-full rounded-full bg-flag" style={{ width: `${Math.max(2, (g.v / maxV) * 100)}%` }} />
        </div>
      </div>
    ));
  };
  if (!open.length) return <Empty text="No live inventory." />;
  return (
    <>
      <Card title="By category">{rows(byCat)}</Card>
      <Card title="By status">{rows(byStatus)}</Card>
      <Card title="Graded vs raw">
        <Line label="Graded (slabbed)" value={String(graded)} />
        <Line label="Raw" value={String(raw)} />
      </Card>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-hairline bg-white">
      <p className="figures px-4 py-10 text-center text-sm text-ink/40">{text}</p>
    </div>
  );
}
