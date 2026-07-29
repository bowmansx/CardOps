// PASTED SOLD COMPS -> ObservedSale[] (2026-07-29).
//
// The lane no API sells. Terapeak, 130point, an auction house's prices-realized
// page, a Seller Hub orders export — all of them put a table on the clipboard
// and none of them offers a feed. `fetchSales` on the adapter contract says
// nothing about HTTP precisely so this can plug in as just another source.
//
// THIS IS USER-SUPPLIED DATA ENTERING A SHARED CATALOGUE, which makes it the
// highest-risk write in the app. `card_market_sales` hangs off the shared
// identity, so one bad paste reaches every owner of that card — `GO-LIVE.md`
// records this as shared-catalogue poisoning. Consequences, and they are the
// reason this file is as careful as it is:
//
//   - Rows carry provenance `manual_paste`, never `vendor`. They are a person's
//     transcription, and the difference has to survive into the database.
//   - A row that parses PARTLY is rejected with a reason, not half-imported. A
//     sale with a price and no date cannot be bucketed into a rollup and would
//     silently distort a median while looking like evidence.
//   - Every rejection is reported. A parser that quietly keeps 8 of 40 rows
//     reads as "your paste had 8 sales" (rule 10).
//   - Nothing here writes. It returns a preview; a human confirms.
//
// AMBIGUOUS DATES ARE THE SUBTLE TRAP. 03/04/2026 is 4 March or 3 April
// depending on locale, and guessing puts the sale in the wrong week — which
// silently corrupts a weekly rollup. See `detectDateOrder`.
import type { ObservedSale, SaleProvenance } from "./observed-sale";
import type { PriceBasis } from "./price-basis";

/** A row we could not turn into a sale, and why. Always surfaced. */
export type RejectedRow = {
  /** 1-based line number as the user sees it in their paste. */
  line: number;
  text: string;
  reason: string;
};

export type PasteResult = {
  sales: ObservedSale[];
  rejected: RejectedRow[];
  /** Which column each field was read from, so the user can check the mapping. */
  columns: Record<string, string>;
  /** How dates were read, and whether that was inferred or certain. */
  dateOrder: DateOrder;
  /** Set when the paste had no recognisable header row. */
  note?: string;
};

const DELIMS = ["\t", "|", ","] as const;

/**
 * Pick the delimiter by CONSISTENCY, not by frequency.
 *
 * Card titles are full of commas ("Topps Chrome, Refractor, /99"), so the comma
 * usually wins a raw count and splits a title into pieces. The delimiter that
 * yields the same column count on every line is the real one.
 */
export function detectDelimiter(lines: string[]): string {
  let best = "\t";
  let bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => l.split(d).length);
    if (counts.some((c) => c < 2)) continue;
    const mode = counts.sort((a, b) => a - b)[counts.length >> 1];
    // Reward agreement, and prefer more columns when two delimiters tie.
    const agree = counts.filter((c) => c === mode).length / counts.length;
    const score = agree * 100 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  // Fall back to runs of 2+ spaces — how a copied HTML table often lands.
  if (bestScore < 0 && lines.some((l) => /\s{2,}/.test(l))) return "  +";
  return best;
}

function split(line: string, delim: string): string[] {
  const parts = delim === "  +" ? line.split(/\s{2,}/) : line.split(delim);
  return parts.map((p) => p.trim().replace(/^"(.*)"$/, "$1").trim());
}

/** Field names we understand, and the header words that map to each. */
const HEADER_MAP: { field: string; words: string[] }[] = [
  // `price` before `title` so "sale price" doesn't match a looser title rule.
  { field: "price", words: ["price", "sold for", "sale price", "amount", "total", "realized", "hammer", "winning bid", "final"] },
  { field: "date", words: ["date", "sold date", "sold on", "end date", "ended", "sale date", "when"] },
  { field: "title", words: ["title", "item", "description", "listing", "card", "name", "lot"] },
  { field: "platform", words: ["platform", "source", "marketplace", "site", "venue", "house", "auction house"] },
  { field: "grader", words: ["grader", "grading company", "company", "tpg"] },
  { field: "grade", words: ["grade", "gr", "cert grade"] },
  { field: "url", words: ["url", "link", "listing url", "item url", "href"] },
  { field: "shipping", words: ["shipping", "ship", "postage", "s&h"] },
];

/** Map header cells to fields. Returns {} when this doesn't look like a header. */
export function mapHeader(cells: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  cells.forEach((cell, i) => {
    const c = cell.toLowerCase().replace(/[^a-z& ]/g, "").trim();
    if (!c) return;
    for (const { field, words } of HEADER_MAP) {
      if (field in out) continue;
      // Exact first, then containment — so "sold price" hits `price` and not
      // `date` via the word "sold".
      if (words.includes(c) || words.some((w) => c === w)) { out[field] = i; return; }
    }
    for (const { field, words } of HEADER_MAP) {
      if (field in out) continue;
      if (words.some((w) => c.includes(w))) { out[field] = i; return; }
    }
  });
  // A header needs at least a price and something to identify the sale by.
  return "price" in out && ("date" in out || "title" in out) ? out : {};
}

const MONEY_RE = /-?[\d,]+(?:\.\d{1,2})?/;

/**
 * Parse a money cell.
 *
 * Returns null rather than 0 for anything unrecognisable — a price is the one
 * field that must never be defaulted (rule 9). Rejects European decimal commas
 * outright instead of guessing: "1.234,56" and "1,234.56" differ by a factor of
 * a thousand and there is no safe assumption.
 */
export function parseMoney(cell: string): number | null {
  const s = cell.trim();
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) return null; // 1.234,56 — ambiguous, refuse
  const m = s.match(MONEY_RE);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export type DateOrder = "iso" | "mdy" | "dmy" | "ambiguous" | "unknown";

/**
 * Work out how the whole paste writes its dates, from all of them at once.
 *
 * The trick that makes this honest: ONE unambiguous row fixes the format for
 * every row. If any date has a first part above 12 it must be a day, so the
 * paste is D/M/Y; if any has a second part above 12 the paste is M/D/Y. Only
 * when every date could be read either way is the answer `ambiguous` — and then
 * the rows are REJECTED rather than guessed, because a month/day swap moves a
 * sale into the wrong week and silently corrupts a rollup.
 */
export function detectDateOrder(cells: string[]): DateOrder {
  let sawSlash = false;
  let firstOver12 = false;
  let secondOver12 = false;
  let sawIso = false;
  for (const c of cells) {
    const s = c.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { sawIso = true; continue; }
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!m) continue;
    sawSlash = true;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  // Contradictory evidence in one paste means the column isn't a clean date.
  if (firstOver12 && secondOver12) return "unknown";
  if (firstOver12) return "dmy";
  if (secondOver12) return "mdy";
  if (sawSlash) return "ambiguous";
  return sawIso ? "iso" : "unknown";
}

/** Parse one date cell under a known order. Returns YYYY-MM-DD or null. */
export function parseDate(cell: string, order: DateOrder): string | null {
  const s = cell.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return ymd(+iso[1], +iso[2], +iso[3]);

  // "14 May 2026" / "May 14, 2026"
  const named = s.match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/);
  if (named) {
    const mon = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    const day = Number(named[1] ?? named[3]);
    if (mon > 0 && day >= 1 && day <= 31) return ymd(+named[4], mon, day);
  }

  const num = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!num) return null;
  // Never guess. An ambiguous paste yields no date, so the row is rejected with
  // a reason the user can act on.
  if (order !== "mdy" && order !== "dmy") return null;
  const a = +num[1], b = +num[2];
  const [mon, day] = order === "mdy" ? [a, b] : [b, a];
  let year = +num[3];
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return ymd(year, mon, day);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Pull a grader and grade out of a title when there are no columns for them. */
export function graderFromTitle(title: string): { grader: string | null; grade: number | null } {
  const m = title.match(/\b(PSA|BGS|SGC|CGC|BVG|HGA|TAG)\s*(10|[1-9](?:\.5)?)\b/i);
  if (!m) return { grader: null, grade: null };
  return { grader: m[1].toUpperCase(), grade: Number(m[2]) };
}

export type PasteOptions = {
  /**
   * Where this paste came from, e.g. "terapeak" or "130point". Becomes the
   * ObservedSale's source, so the same licence and basis machinery applies.
   */
  source: string;
  /** Marketplace, when the paste has no platform column. */
  defaultPlatform?: string | null;
  /**
   * What the pasted prices INCLUDE.
   *
   * The caller must state this. A prices-realized page from an auction house is
   * hammer; an eBay sold search is all-in. Defaulting it would reintroduce
   * exactly the ~22% error the basis work removed.
   */
  priceBasis: PriceBasis;
  /** Always `manual_paste` today; a parameter so an upload path can differ. */
  provenance?: SaleProvenance;
};

/**
 * Parse a pasted table of sold comps.
 *
 * Pure. Returns a preview plus every rejection — nothing is written, and a human
 * confirms before anything reaches the shared catalogue.
 */
export function parsePastedSales(text: string, opts: PasteOptions): PasteResult {
  const rawLines = text.split(/\r?\n/);
  // Keep the original line numbers so a rejection points at what the user sees.
  const numbered = rawLines
    .map((text, i) => ({ text, line: i + 1 }))
    .filter((l) => l.text.trim().length > 0);

  if (!numbered.length) {
    return { sales: [], rejected: [], columns: {}, dateOrder: "unknown", note: "nothing pasted" };
  }

  const delim = detectDelimiter(numbered.map((l) => l.text));
  const headerCells = split(numbered[0].text, delim);
  const cols = mapHeader(headerCells);

  if (!Object.keys(cols).length) {
    return {
      sales: [], rejected: [], columns: {}, dateOrder: "unknown",
      note: "couldn't find a header row — paste the table including its column headings, so each number is read as the right field",
    };
  }

  const body = numbered.slice(1);
  const rows = body.map((l) => ({ ...l, cells: split(l.text, delim) }));

  // Establish the date format across the WHOLE paste before reading any row.
  const dateOrder = cols.date != null
    ? detectDateOrder(rows.map((r) => r.cells[cols.date] ?? ""))
    : "unknown";

  const sales: ObservedSale[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const cell = (f: string) => (cols[f] != null ? r.cells[cols[f]] ?? "" : "");
    const price = parseMoney(cell("price"));
    if (price == null) {
      rejected.push({ line: r.line, text: r.text, reason: `no readable price in the ${headerCells[cols.price] ?? "price"} column` });
      continue;
    }
    const soldAt = cols.date != null ? parseDate(cell("date"), dateOrder) : null;
    if (cols.date != null && !soldAt) {
      rejected.push({
        line: r.line, text: r.text,
        reason: dateOrder === "ambiguous"
          ? "every date in this paste could be read as either day/month or month/day — say which, or paste dates as YYYY-MM-DD"
          : `couldn't read the date "${cell("date")}"`,
      });
      continue;
    }
    // A sale with no date cannot be bucketed into a rollup, and would distort a
    // median while looking like evidence.
    if (!soldAt) {
      rejected.push({ line: r.line, text: r.text, reason: "no sale date — a comp without a date can't be placed in time" });
      continue;
    }

    const title = cell("title") || null;
    const fromTitle = title ? graderFromTitle(title) : { grader: null, grade: null };
    const graderCell = cell("grader");
    const gradeCell = cell("grade");
    const grader = graderCell ? graderCell.toUpperCase() : fromTitle.grader;
    const gradeNum = gradeCell ? Number(gradeCell.replace(/[^\d.]/g, "")) : fromTitle.grade;
    const grade = Number.isFinite(gradeNum as number) ? (gradeNum as number) : null;

    // Stable within this source, and stable across re-pastes of the same table
    // so importing twice doesn't double-count.
    const externalId = `paste:${soldAt}:${price}:${(title ?? "").slice(0, 48)}`;
    if (seen.has(externalId)) {
      rejected.push({ line: r.line, text: r.text, reason: "duplicate of an earlier row in this paste" });
      continue;
    }
    seen.add(externalId);

    sales.push({
      externalId,
      price,
      currency: "USD",
      priceBasis: opts.priceBasis,
      soldAt,
      platform: cell("platform") || opts.defaultPlatform || null,
      title,
      url: cell("url") || null,
      grader,
      grade,
      // A paste can't establish graded-vs-raw beyond what it literally says. A
      // grader found in the title is evidence of graded; its absence is not
      // evidence of raw.
      isGraded: grader ? true : null,
      confirmed: true,
    });
  }

  const columns: Record<string, string> = {};
  for (const [field, i] of Object.entries(cols)) columns[field] = headerCells[i] ?? `column ${i + 1}`;

  return { sales, rejected, columns, dateOrder };
}
