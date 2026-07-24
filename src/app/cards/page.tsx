import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { CARD_STATUSES, CATEGORIES, TAG_FACETS, type Card } from "@/lib/cards/types";
import { readAllSafe } from "@/lib/supabase/page";
import { lotRemainingTotal } from "@/lib/cards/basis";
import { CardBrowser } from "@/components/cards/CardBrowser";
import { CardsMoreMenu } from "@/components/cards/CardsMoreMenu";
import { EbayLogo } from "@/components/cards/EbayLogo";

export const dynamic = "force-dynamic";

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

type SP = { status?: string; q?: string; cat?: string; tags?: string; sort?: string; view?: string; group?: string };

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "price", label: "Price ↓" },
  { key: "price_low", label: "Price ↑" },
  { key: "year", label: "Year" },
  { key: "player", label: "A–Z" },
] as const;

// Columns including the tag/storage fields from the two newest migrations;
// LEGACY_COLS is the pre-migration fallback so the inventory never 500s
// before a paste.
// Typed as plain `string` so supabase-js doesn't literal-parse the column
// list (TS2589 deep-instantiation) and both queries share one result type.
const FULL_COLS: string =
  "id, sku, player, year, set_name, card_number, sport_category, grader, grade, status, zone, location_code, market_value, manual_price, is_rookie, is_auto, is_relic, serial_number, condition_type, rarity, brand, storage_location, value_30d, value_365d, created_at";
const LEGACY_COLS: string =
  "id, sku, player, year, set_name, card_number, sport_category, grader, grade, status, zone, location_code, market_value, manual_price, is_rookie, is_auto, is_relic, serial_number, condition_type, created_at";

export default async function CardsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  const cat = sp.cat && CATEGORIES.some((c) => c.key === sp.cat) ? sp.cat : null;
  const tags = (sp.tags ?? "").split(",").filter((t) => TAG_FACETS.some((f) => f.key === t));
  const sort = SORTS.some((s) => s.key === sp.sort) ? (sp.sort as string) : "newest";
  const grouped = sp.view === "grouped";

  // Group/folder filter: resolve member card ids up front.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const groupId = sp.group && UUID.test(sp.group) ? sp.group : null;
  let groupIds: string[] | null = null;
  if (groupId) {
    const { data: gm } = await supabase.from("card_group_items").select("card_id").eq("group_id", groupId).limit(1000);
    groupIds = (gm ?? []).map((x) => x.card_id as string);
    if (groupIds.length === 0) groupIds = ["00000000-0000-0000-0000-000000000000"]; // empty group → no matches
  }

  function buildQuery(cols: string) {
    let q = supabase.from("cards").select(cols).neq("status", "archived").limit(500);
    if (groupIds) q = q.in("id", groupIds);
    if (sp.status && CARD_STATUSES.includes(sp.status as (typeof CARD_STATUSES)[number])) {
      q = q.eq("status", sp.status);
    }
    if (cat) q = q.eq("sport_category", cat);
    if (sp.q) {
      const term = sp.q.replace(/[,()]/g, " ").trim();
      if (term) q = q.or(`player.ilike.%${term}%,set_name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
    }
    for (const t of tags) {
      if (t === "rc") q = q.eq("is_rookie", true);
      else if (t === "auto") q = q.eq("is_auto", true);
      else if (t === "patch") q = q.eq("is_relic", true);
      else if (t === "rpa") q = q.eq("is_rookie", true).eq("is_auto", true).eq("is_relic", true);
      else if (t === "numbered") q = q.not("serial_number", "is", null);
      else if (t === "graded") q = q.eq("condition_type", "graded");
      else if (t === "raw") q = q.eq("condition_type", "raw");
      else q = q.eq("grader", t.toUpperCase());
    }
    if (sort === "price") q = q.order("market_value", { ascending: false, nullsFirst: false });
    else if (sort === "price_low") q = q.order("market_value", { ascending: true, nullsFirst: false });
    else if (sort === "year") q = q.order("year", { ascending: false, nullsFirst: false });
    else if (sort === "player") q = q.order("player", { ascending: true, nullsFirst: false });
    else q = q.order("created_at", { ascending: false });
    return q;
  }

  // brand.ilike in search also needs the column — strip it in the fallback.
  let { data: rows, error } = await buildQuery(FULL_COLS);
  if (error) {
    let q = buildQuery(LEGACY_COLS);
    if (sp.q) {
      const term = sp.q.replace(/[,()]/g, " ").trim();
      q = supabase.from("cards").select(LEGACY_COLS).neq("status", "archived").limit(500)
        .or(`player.ilike.%${term}%,set_name.ilike.%${term}%,sku.ilike.%${term}%`)
        .order("created_at", { ascending: false });
    }
    ({ data: rows, error } = await q);
  }
  const cards = (rows ?? []) as unknown as Partial<Card>[];
  const role = await currentRole();
  // Businesses to attribute cards to. Every card user has their OWN (card_businesses
  // is RLS-scoped to the caller), so this is no longer owner-gated.
  const entities =
    (await supabase.from("card_businesses").select("id, name, short_code").eq("active", true).order("short_code")).data ?? [];

  const [lotsPage, { count: invCount }, { data: groupsList }] = await Promise.all([
    readAllSafe<{ id: string; remaining_cost: number | null; remaining_count: number | null }>((from, to) =>
      supabase.from("purchase_lots").select("id, remaining_cost, remaining_count")
        .order("id", { ascending: true }).range(from, to)),
    supabase.from("cards").select("id", { count: "exact", head: true }).neq("status", "archived"),
    supabase.from("card_groups").select("id, name").order("sort").order("name"),
  ]);
  const myGroups = (groupsList ?? []) as { id: string; name: string }[];
  const poolTotal = lotRemainingTotal(lotsPage.rows);
  const poolCount = lotsPage.rows.reduce((s, l) => s + Number(l.remaining_count ?? 0), 0);

  // Portfolio banner (Beau): cost basis vs accumulated market value vs return %.
  // Values-only paged scan of live inventory (capped; move to an RPC if the
  // shelf ever exceeds this). Cost basis = pool total + individual-basis cards.
  let marketValue = 0;
  let individualBasis = 0;
  for (let from = 0; from < 8000; from += 1000) {
    const { data: vrows } = await supabase
      .from("cards")
      .select("market_value, manual_price, purchase_lot_id, individual_basis")
      .not("status", "in", "(archived,sold)")
      .order("id", { ascending: true })
      .range(from, from + 999);
    for (const v of vrows ?? []) {
      marketValue += Number((v.manual_price ?? v.market_value) ?? 0);
      if (!v.purchase_lot_id) individualBasis += Number(v.individual_basis ?? 0);
    }
    if (!vrows || vrows.length < 1000) break;
  }
  const costBasis = poolTotal + individualBasis;
  const returnPct = costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : null;

  // Build hrefs that PRESERVE the other filters (chips compose, not reset).
  function href(overrides: Partial<SP>): string {
    const merged: Record<string, string | undefined> = {
      status: sp.status, q: sp.q, cat: cat ?? undefined,
      tags: tags.join(",") || undefined, sort: sort === "newest" ? undefined : sort,
      view: grouped ? "grouped" : undefined, group: groupId ?? undefined,
      ...overrides,
    };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return qs ? `/cards?${qs}` : "/cards";
  }
  const toggleTag = (key: string) =>
    href({ tags: (tags.includes(key) ? tags.filter((t) => t !== key) : [...tags, key]).join(",") || undefined });

  const chipCls = (on: boolean) =>
    "rounded-full border px-3 py-1 text-xs font-semibold " +
    (on ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60");

  const hasFilters = Boolean(sp.status || cat || tags.length || sort !== "newest" || grouped || groupId);
  const filterSummary =
    [
      sp.status,
      cat ? CATEGORIES.find((c) => c.key === cat)?.short : null,
      ...tags.map((t) => TAG_FACETS.find((f) => f.key === t)?.label),
      sort !== "newest" ? SORTS.find((s) => s.key === sort)?.label : null,
      grouped ? "Grouped" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "All cards · Newest";

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-3xl px-4 pb-24">
        <header className="flex items-center justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cards</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <Link href="/cards/pricing" className="text-center leading-tight text-flag underline-offset-4 hover:underline">
              <span className="block text-xs font-semibold">Pricing</span>
              <span className="block text-[10px] font-semibold text-flag/70">Templates</span>
            </Link>
            <Link href="/cards/show" className="text-xs font-semibold text-flag underline-offset-4 hover:underline">Show</Link>
            {role === "owner" && (
              <Link href="/cards/ebay" aria-label="eBay" className="leading-none">
                <EbayLogo className="text-sm" />
              </Link>
            )}
            <CardsMoreMenu isOwner={role === "owner"} />
          </span>
        </header>

        {/* Portfolio banner (tap → value-over-time): cost basis · market value · return. */}
        <Link href="/cards/portfolio" className="mt-3 grid grid-cols-3 divide-x divide-hairline overflow-hidden rounded-xl border border-hairline bg-white hover:border-flag/50">
          <div className="px-3 py-2.5">
            <div className="figures text-lg font-bold text-ink">{money(costBasis)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink/50">Cost basis · {invCount ?? poolCount}</div>
          </div>
          <div className="px-3 py-2.5">
            <div className="figures text-lg font-bold text-ink">{money(marketValue)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink/50">Market value</div>
          </div>
          <div className="px-3 py-2.5">
            <div className={"figures text-lg font-bold " + (returnPct == null ? "text-ink/40" : returnPct >= 0 ? "text-pos" : "text-danger")}>
              {returnPct == null ? "—" : `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(0)}%`}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink/50">Return ›</div>
          </div>
        </Link>

        <form className="mt-4 flex gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search player, set, brand, SKU…"
            className="flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag"
          />
          <button className="rounded-lg border border-hairline bg-white px-4 text-sm font-semibold">Search</button>
        </form>

        {/* One calm header bar — all filters live inside, summary shows the
            active picks when closed. Stays open while composing (any active
            filter keeps it expanded across the chip-link navigations). */}
        <details {...(hasFilters ? { open: true } : {})} className="mt-3 overflow-hidden rounded-xl border border-hairline bg-white">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
            <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-ink">
              <SlidersHorizontal size={15} className="text-flag" /> Filters &amp; sort
            </span>
            <span className="figures min-w-0 truncate text-[11px] text-ink/50">{filterSummary}</span>
          </summary>
          <div className="space-y-3 border-t border-hairline px-4 py-3">
            {myGroups.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink/40">Groups / folders</div>
                <div className="flex flex-wrap gap-1.5">
                  {myGroups.map((g) => (
                    <Link key={g.id} href={href({ group: groupId === g.id ? undefined : g.id })} className={chipCls(groupId === g.id)}>
                      {g.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink/40">Status</div>
              <div className="flex flex-wrap gap-1.5">
                <Link href={href({ status: undefined })} className={chipCls(!sp.status)}>All</Link>
                {CARD_STATUSES.filter((s) => s !== "archived").map((s) => (
                  <Link key={s} href={href({ status: s })} className={chipCls(sp.status === s)}>{s}</Link>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink/40">Sport / game</div>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <Link key={c.key} href={href({ cat: cat === c.key ? undefined : c.key })} className={chipCls(cat === c.key)}>
                    {c.short}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink/40">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {TAG_FACETS.map((f) => (
                  <Link key={f.key} href={toggleTag(f.key)} className={chipCls(tags.includes(f.key))}>
                    {f.label}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink/40">Sort · view</div>
              <div className="flex flex-wrap gap-1.5">
                {SORTS.map((s) => (
                  <Link key={s.key} href={href({ sort: s.key === "newest" ? undefined : s.key })} className={chipCls(sort === s.key)}>
                    {s.label}
                  </Link>
                ))}
                <Link href={href({ view: grouped ? undefined : "grouped" })} className={chipCls(grouped)}>
                  Grouped
                </Link>
              </div>
            </div>

            {/* Legend: full names behind the short chips + tag codes. */}
            <details className="border-t border-hairline pt-2">
              <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-ink/40 [&::-webkit-details-marker]:hidden">
                Legend — what the labels mean ›
              </summary>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-ink/55">
                {CATEGORIES.map((c) => (
                  <div key={c.key} className="flex justify-between gap-2">
                    <span className="font-semibold text-ink/70">{c.short}</span><span className="truncate text-right">{c.label}</span>
                  </div>
                ))}
                {TAG_FACETS.map((f) => (
                  <div key={f.key} className="flex justify-between gap-2">
                    <span className="font-semibold text-ink/70">{f.label}</span><span className="truncate text-right">{f.full}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </details>

        <CardBrowser cards={cards} grouped={grouped} entities={entities as { id: string; name: string; short_code: string }[]} />
      </div>

      <Link
        href="/cards/intake"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-flag text-2xl font-bold text-white shadow-lg transition active:scale-95"
        aria-label="Add a card — scan with the camera"
      >
        +
      </Link>
    </main>
  );
}
