import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import type { PipelineV1 } from "@/lib/cards/valuation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Pricing-format generator: "ai" reasons from locked values + keywords;
// "random" rolls sensible dice for free. Either way the caller's LOCKED
// values are force-reapplied afterward — a locked field can never drift,
// so re-rolling explores around exactly what the user pinned.

type GenBody = {
  mode?: "ai" | "random";
  locked?: Partial<PipelineV1> & { label?: string };
  keywords?: string[];
};

const Gen = z.object({
  label: z.string().describe("Short punchy name for this pricing format, e.g. 'Patient Vintage Median'."),
  desc: z.string().describe("One sentence: what this format does and when to use it."),
  tags: z.array(z.string()).describe("3-6 suitability tags for the card types this fits: e.g. 'low population', 'high volume', 'low volume', 'numbered', 'vintage', 'hot player', 'fast flip', 'stable market', 'graded', 'raw'."),
  sources: z.array(z.string()).describe("Comp sources to include (subset of: manual, cardladder, ebay, pricecharting, auction). Empty = all sources."),
  comp_scope: z.enum(["raw", "own_grade", "cross_grade"]).describe("Which sales count: raw = ungraded sales (default); own_grade = the card's own grader+grade; cross_grade = same grade number borrowed from other companies."),
  grade_delta: z.number().nullable().describe("For graded scopes: ± wiggle around the card's grade (0, 0.5, 1, 1.5, 2). Null when scope is raw."),
  grade_companies: z.array(z.string()).describe("For cross_grade: which graders' sales to borrow (subset of PSA, BGS, SGC, CGC). Empty = any grader."),
  window_days: z.number().nullable().describe("Look-back window in days (7-3650), or null for all-time."),
  last_n: z.number().nullable().describe("Keep only the newest N sales (1-50), or null for all in window."),
  top_n: z.number().nullable().describe("Then keep only the N HIGHEST-priced sales (e.g. 'average of the 5 highest ever' = null window + top_n 5 + mean), or null."),
  min_comps: z.number().describe("Minimum qualifying sales (1-10) — fewer means the format abstains."),
  drop_top_pct: z.number().nullable().describe("Drop this fraction of highest sales first (0-0.3), or null."),
  drop_bottom_pct: z.number().nullable().describe("Drop this fraction of lowest sales (0-0.3), or null."),
  iqr_k: z.number().nullable().describe("IQR outlier fence multiplier (1-3, 1.5 classic), or null for no fence."),
  aggregate_fn: z.enum(["mean", "median", "trimmed_mean", "wavg_recency", "last_sale", "min", "max"]),
  trim_pct: z.number().nullable().describe("For trimmed_mean: fraction trimmed each side (0.05-0.25), else null."),
  half_life_days: z.number().nullable().describe("For wavg_recency: half-life in days (7-120), else null."),
  multiplier: z.number().nullable().describe("Final price multiplier (0.85-1.2), or null for 1.0."),
  round_99: z.boolean().describe("Round the result to a .99 price."),
});

function pick<T>(xs: T[]): T { return xs[Math.floor(Math.random() * xs.length)]; }
const chance = (p: number) => Math.random() < p;

function rollRandom(): z.infer<typeof Gen> {
  const fn = pick(["median", "median", "trimmed_mean", "trimmed_mean", "mean", "wavg_recency", "min", "max", "last_sale"] as const);
  const window_days = pick([30, 60, 90, 90, 180, 365, 730, null]);
  const last_n = pick([5, 8, 10, 10, 15, 20, null]);
  const min_comps = pick([1, 2, 3, 3, 4, 5]);
  const iqr_k = chance(0.6) ? pick([1.5, 1.5, 2]) : null;
  const drop_top_pct = chance(0.45) ? pick([0.1, 0.1, 0.15, 0.2]) : null;
  const drop_bottom_pct = chance(0.3) ? pick([0.1, 0.15]) : null;
  const multiplier = chance(0.55) ? pick([0.92, 0.95, 0.97, 1, 1.03, 1.05, 1.1]) : null;
  const round_99 = chance(0.3);
  const trim_pct = fn === "trimmed_mean" ? pick([0.1, 0.15]) : null;
  const half_life_days = fn === "wavg_recency" ? pick([14, 21, 30, 45]) : null;

  const tags: string[] = [];
  if ((window_days ?? 9999) <= 60 || fn === "wavg_recency" || fn === "last_sale") tags.push("hot player", "high volume");
  if (window_days == null || window_days >= 365) tags.push("low volume", "vintage");
  if (min_comps <= 2) tags.push("low population");
  if (fn === "min" || (multiplier ?? 1) < 0.97) tags.push("fast flip");
  if (iqr_k != null || drop_top_pct != null) tags.push("outlier-protected");
  if ((multiplier ?? 1) > 1.02) tags.push("numbered", "premium");
  if (!tags.length) tags.push("stable market");

  const top_n = chance(0.22) ? pick([3, 5, 10]) : null;
  const comp_scope = chance(0.2) ? pick(["own_grade", "cross_grade"] as const) : ("raw" as const);
  const grade_delta = comp_scope === "raw" ? null : pick([0, 0.5, 0.5, 1]);
  if (comp_scope !== "raw") tags.push("graded");
  if (top_n != null) tags.push("premium");

  const windowTxt = window_days == null ? "all-time" : `${window_days}d`;
  const label = `${fn.replace(/_/g, " ")} · ${windowTxt}${last_n ? ` · last ${last_n}` : ""}${top_n ? ` · top ${top_n}` : ""}${multiplier && multiplier !== 1 ? ` · ×${multiplier}` : ""}`;
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    desc: `Rolls a ${fn.replace(/_/g, " ")} over ${windowTxt} sales${iqr_k ? " with an outlier fence" : ""}.`,
    tags: [...new Set(tags)].slice(0, 5),
    sources: [],
    comp_scope, grade_delta, grade_companies: [],
    window_days, last_n, top_n, min_comps, drop_top_pct, drop_bottom_pct, iqr_k,
    aggregate_fn: fn, trim_pct, half_life_days, multiplier, round_99,
  };
}

function toPipeline(g: z.infer<typeof Gen>): PipelineV1 {
  return {
    sources: g.sources.length ? g.sources : null,
    comp_scope: g.comp_scope === "raw" ? undefined : g.comp_scope,
    grade_delta: g.comp_scope === "raw" ? undefined : g.grade_delta ?? 0,
    grade_companies: g.comp_scope === "cross_grade" && g.grade_companies.length ? g.grade_companies : undefined,
    window_days: g.window_days,
    last_n: g.last_n,
    top_n: g.top_n,
    min_comps: g.min_comps,
    guards: {
      drop_top_pct: g.drop_top_pct ?? undefined,
      drop_bottom_pct: g.drop_bottom_pct ?? undefined,
      iqr_k: g.iqr_k ?? undefined,
    },
    aggregate: {
      fn: g.aggregate_fn,
      trim_pct: g.trim_pct ?? undefined,
      half_life_days: g.half_life_days ?? undefined,
    },
    adjust: { multiplier: g.multiplier ?? undefined, round_99: g.round_99 },
  };
}

// Locked values win, always — including nested blocks.
function applyLocks(gen: PipelineV1, locked: Partial<PipelineV1>): PipelineV1 {
  return {
    ...gen,
    ...locked,
    guards: { ...gen.guards, ...(locked.guards ?? {}) },
    aggregate: locked.aggregate
      ? { ...gen.aggregate, ...locked.aggregate }
      : gen.aggregate,
    adjust: { ...gen.adjust, ...(locked.adjust ?? {}) },
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Validate the body (day-review): malformed shapes 400 instead of 500, and
  // caps stop cost amplification via huge locked objects / keywords.
  const BodySchema = z.object({
    mode: z.enum(["ai", "random"]).optional(),
    keywords: z.array(z.string().max(80)).max(12).optional(),
    locked: z.record(z.string(), z.unknown()).optional(),
  });
  const parsedBody = BodySchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsedBody.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const body = parsedBody.data as GenBody;
  const locked = body.locked ?? {};
  if (JSON.stringify(locked).length > 4000) {
    return NextResponse.json({ error: "Locked payload too large." }, { status: 400 });
  }
  const keywords = (body.keywords ?? []).map(String).filter(Boolean).slice(0, 12);

  // Spend guardrail: AI mode requires the toggle; when off, fall through to
  // the free dice so the button still does something.
  let aiAllowed = body.mode === "ai";
  if (aiAllowed) {
    const svcGate = createServiceClient();
    const { data: cfg } = svcGate
      ? await svcGate.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
      : { data: null };
    aiAllowed = !!cfg?.enabled;
  }

  let gen: z.infer<typeof Gen>;
  if (aiAllowed) {
    try {
      const message = await anthropic.messages.parse({
        model: MODEL,
        max_tokens: 800,
        system: [{
          type: "text",
          text: `You design card-pricing calculation formats for a reseller's inventory system. A format computes market value from sale comps via: source filter → look-back window → last-N sales → outlier guards → minimum-comps check → aggregate → final adjust. Given LOCKED values (which you MUST keep exactly as provided — design around them, never change them) and optional KEYWORDS describing the card type or goal, produce ONE coherent, well-reasoned format. Rules of thumb: thin/low-pop markets need long windows + low min_comps; hot/high-volume wants short windows or recency weighting; fast-flip prices below market (min or multiplier <1); numbered/premium can price above median; always consider an outlier guard. Tags describe which cards the format suits.`,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `LOCKED (must appear unchanged): ${JSON.stringify(locked)}\nKEYWORDS: ${keywords.join(", ") || "(none)"}\nDesign the format.`,
        }],
        output_config: { format: zodOutputFormat(Gen) },
      });
      if (!message.parsed_output) throw new Error("no output");
      gen = message.parsed_output;
    } catch {
      // AI hiccup → fall back to dice so the button always does something.
      gen = rollRandom();
    }
  } else {
    gen = rollRandom();
  }

  const pipeline = applyLocks(toPipeline(gen), locked);
  return NextResponse.json({
    label: locked.label ?? gen.label,
    desc: gen.desc,
    tags: gen.tags,
    pipeline,
  });
}
