"use client";

import { useEffect, useRef, useState } from "react";
import { Newspaper, Loader2, TrendingUp, Telescope, Zap, ChevronDown, ChevronRight, Clock, RefreshCw } from "lucide-react";
import type { CardIntel as Intel } from "@/lib/cards/card-intel-schema";

const VERDICT_STYLE: Record<Intel["verdict"], { label: string; cls: string }> = {
  strong_buy: { label: "STRONG BUY", cls: "bg-pos text-[#0b1712]" },
  buy: { label: "BUY", cls: "bg-pos/20 text-pos border border-pos/40" },
  hold: { label: "HOLD", cls: "bg-flag/20 text-flag border border-flag/40" },
  sell: { label: "SELL", cls: "bg-danger/20 text-danger border border-danger/40" },
  strong_sell: { label: "STRONG SELL", cls: "bg-danger text-white" },
};

const TIER_LABEL: Record<string, string> = {
  light: "quick take · no web",
  medium: "web scan",
  deep: "deep dive",
};

// The three horizons, in display order. Each is its own collapsible dropdown.
const HORIZONS = [
  { key: "flip", label: "Fast flip", sub: "days–weeks", icon: Zap },
  { key: "season", label: "This season", sub: "weeks–months", icon: TrendingUp },
  { key: "longterm", label: "Long hold", sub: "6mo+", icon: Telescope },
] as const;
type HKey = (typeof HORIZONS)[number]["key"];

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const t = await r.text();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    const clean = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    throw new Error(clean || `Request failed (HTTP ${r.status}) — likely a timeout; try again.`);
  }
}

const openKey = (h: string) => `mo_intel_open_${h}`;

// Light takes are kept ~2 weeks, then auto-refresh on the next card open.
const STALE_MS = 14 * 24 * 3600_000;
const isStale = (at?: string) => {
  if (!at) return true;
  const t = new Date(at).getTime();
  return !Number.isFinite(t) || Date.now() - t > STALE_MS;
};
// Friendly "when was this scanned" for the last-updated line.
const fmtWhen = (at?: string) => {
  if (!at) return "";
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Card Intel (Beau, 2026-07-19): three collapsible horizon dropdowns — Fast
 * flip / This season / Long hold — each holding its OWN take. Default: only
 * This season is open, but a LIGHT quick-take prefetches for ALL three on card
 * open so the collapsed sections are ready the moment you expand them; the take
 * persists server-side and auto-refreshes once it's ~2 weeks old. Each section
 * shows a bright "Updated …" line + a manual Refresh. Open/closed state
 * persists per horizon; Web scan / Deep dive upgrade a section on demand.
 */
export function CardIntel({ cardId, initial }: { cardId: string; initial: Record<string, Intel | null> }) {
  const [intels, setIntels] = useState<Record<string, Intel | null>>({
    flip: initial.flip ?? null, season: initial.season ?? null, longterm: initial.longterm ?? null,
  });
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [err, setErr] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const read = (h: string, def: boolean) => {
      try { const v = localStorage.getItem(openKey(h)); return v == null ? def : v === "1"; } catch { return def; }
    };
    // Default: only "this season" open.
    return { flip: read("flip", false), season: read("season", true), longterm: read("longterm", false) };
  });
  const autoRan = useRef<Set<string>>(new Set());

  function setOpenH(h: HKey, v: boolean) {
    setOpen((p) => ({ ...p, [h]: v }));
    try { localStorage.setItem(openKey(h), v ? "1" : "0"); } catch {}
  }

  async function run(h: HKey, tier: "light" | "medium" | "deep", opts?: { auto?: boolean }) {
    setBusy((p) => ({ ...p, [h]: tier }));
    if (!opts?.auto) setErr((p) => ({ ...p, [h]: null }));
    try {
      const r = await fetch("/api/cards/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, horizon: h, tier, force: !opts?.auto && intels[h] != null }),
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error((d.error as string) || "Intel failed.");
      setIntels((p) => ({ ...p, [h]: d.intel as Intel }));
      setErr((p) => ({ ...p, [h]: null }));
    } catch (e) {
      if (!opts?.auto) setErr((p) => ({ ...p, [h]: e instanceof Error ? e.message : "Intel failed." }));
    } finally {
      setBusy((p) => ({ ...p, [h]: null }));
    }
  }

  // Prefetch on card open (Beau): light-run ALL three horizons — not just the
  // open one — so Fast flip / Long hold are ready the instant you expand them,
  // and their takes persist server-side. A stored LIGHT take auto-refreshes
  // once it's older than the 2-week window; a fresh take (or a user-run
  // medium/deep) is left alone. Runs once per horizon per mount.
  useEffect(() => {
    for (const { key } of HORIZONS) {
      if (autoRan.current.has(key)) continue;
      const it = intels[key];
      const tier = it?.tier ?? "light";
      // Run a light take when there's none, or when the stored LIGHT take has
      // aged past the window. A user-run web scan / deep dive is left as-is —
      // its Refresh button handles staleness, so we never auto-downgrade it.
      const needsRun = !it || (tier === "light" && isStale(it.at));
      if (needsRun) {
        autoRan.current.add(key);
        void run(key, "light", { auto: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="mt-4">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
        <Newspaper size={13} className="text-flag" /> Card intel
      </h2>

      <div className="mt-2 space-y-2">
        {HORIZONS.map(({ key, label, sub, icon: Icon }) => {
          const isOpen = open[key];
          const intel = intels[key];
          const b = busy[key];
          const v = intel ? VERDICT_STYLE[intel.verdict] : null;
          return (
            <div key={key} className="overflow-hidden rounded-xl border border-hairline bg-white">
              {/* Header / toggle */}
              <button onClick={() => setOpenH(key, !isOpen)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                {isOpen ? <ChevronDown size={15} className="shrink-0 text-ink/40" /> : <ChevronRight size={15} className="shrink-0 text-ink/40" />}
                <Icon size={14} className="shrink-0 text-flag" />
                <span className="text-sm font-bold text-ink">{label}</span>
                <span className="text-[10px] text-ink/35">{sub}</span>
                {/* collapsed peek: the verdict badge if we have one */}
                {!isOpen && v && (
                  <span className={`figures ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${v.cls}`}>{v.label}</span>
                )}
                {!isOpen && !v && b && <Loader2 size={12} className="ml-auto animate-spin text-ink/40" />}
              </button>

              {isOpen && (
                <div className="border-t border-hairline">
                  {/* Actions */}
                  <div className="flex items-center gap-1.5 px-3 py-2">
                    <button onClick={() => run(key, "medium")} disabled={b != null}
                      className="flex items-center gap-1 rounded-lg border border-flag/50 px-2.5 py-1 text-xs font-bold text-flag disabled:opacity-50"
                      title="A few live web searches (~20s)">
                      {b === "medium" ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />} Web scan
                    </button>
                    <button onClick={() => run(key, "deep")} disabled={b != null}
                      className="flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-xs font-semibold text-ink/70 disabled:opacity-50"
                      title="The full dig — more searches, ~45s">
                      {b === "deep" ? <Loader2 size={12} className="animate-spin" /> : <Telescope size={12} />} Deep dive
                    </button>
                    {b === "light" && (
                      <span className="flex items-center gap-1 text-[11px] text-ink/40"><Loader2 size={11} className="animate-spin" /> quick take…</span>
                    )}
                  </div>

                  {err[key] && <p className="px-3 pb-2 text-xs leading-snug text-danger">{err[key]}</p>}

                  {intel && v ? (
                    <div className="border-t border-hairline">
                      <div className="flex items-start gap-3 border-b border-hairline px-3 py-2.5">
                        <span className={`figures shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold ${v.cls}`}>{v.label}</span>
                        <div className="min-w-0">
                          <p className="text-[12px] leading-snug text-ink/75">{intel.verdict_reason}</p>
                          <span className="figures mt-0.5 inline-flex items-center gap-1 rounded bg-ink/8 px-1 py-px text-[9px] font-bold text-ink/45">
                            {intel.tier === "light" && <Zap size={8} />} {TIER_LABEL[intel.tier ?? "medium"] ?? intel.tier}
                          </span>
                        </div>
                      </div>
                      <div className="border-b border-hairline px-3 py-2.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-flag">When to sell</div>
                        <p className="mt-0.5 text-[12px] leading-snug text-ink/80">{intel.timing_strategy}</p>
                        <p className="mt-1 text-[11px] leading-snug text-ink/50"><b>Watch for:</b> {intel.watch_for}</p>
                      </div>
                      {intel.news.length > 0 ? (
                        intel.news.map((n, i) => (
                          <div key={i} className="border-b border-hairline px-3 py-2 last:border-b-0">
                            <p className="text-[12px] font-semibold leading-snug text-ink">{n.headline}</p>
                            <p className="figures text-[10px] text-ink/40">{n.source}{n.when ? ` · ${n.when}` : ""}</p>
                            <p className="mt-0.5 text-[11px] leading-snug text-ink/60">{n.why_it_matters}</p>
                          </div>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-[11px] text-ink/45">
                          {intel.tier === "light"
                            ? "Quick take from fundamentals — tap Web scan or Deep dive for live news."
                            : "No relevant news found — a quiet market is itself a signal."}
                        </p>
                      )}
                      {/* Last updated (Beau: bright reminder) + manual refresh.
                          Turns amber once past the 2-week auto-refresh window. */}
                      <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2">
                        <span className={`figures inline-flex items-center gap-1 text-[11px] font-bold ${isStale(intel.at) ? "text-danger" : "text-flag"}`}>
                          <Clock size={11} className="shrink-0" />
                          Updated {fmtWhen(intel.at)}{isStale(intel.at) ? " · stale — refresh?" : ""}
                        </span>
                        <button
                          onClick={() => run(key, (intel.tier as "light" | "medium" | "deep") ?? "light")}
                          disabled={b != null}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline px-2 py-0.5 text-[11px] font-semibold text-ink/60 hover:text-ink disabled:opacity-50"
                          title="Re-run this take now">
                          <RefreshCw size={11} className={b ? "animate-spin" : ""} /> Refresh
                        </button>
                      </div>
                    </div>
                  ) : (
                    !b && <p className="px-3 pb-3 text-[11px] text-ink/40">No take yet — tap Web scan or Deep dive.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-ink/40">Decision support, not financial advice. Quick takes refresh automatically about every 2 weeks — or tap Refresh anytime.</p>
    </section>
  );
}
