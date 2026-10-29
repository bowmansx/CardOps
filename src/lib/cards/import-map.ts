// READ ANOTHER APP'S INVENTORY FILE (2026-10-28).
//
// `spec/00-what-cardops-is.md`: CardOps "can also receive an inventory system
// from the template/format of any other inventory software and restructure the
// template/format". Import did not. It read its OWN column names and nothing
// else, so a file from Card Ladder, Collectr or a Google Sheet with headers like
// "Player Name" / "Card #" / "Set" matched nothing — and still "succeeded",
// creating one BLANK card per row with a fresh SKU. Saved from Excel, even a
// file in CardOps' own columns lost its first column to the byte-order mark.
//
// THIS MODULE RECOGNISES VOCABULARY, NOT VENDORS. There is no "Card Ladder
// profile" here, because nobody has checked one against a real export, and a
// format guessed from memory is a wrong mapping that looks authoritative. What
// is here is the words inventory files use for each field, matched EXACTLY
// after normalisation. Containment matching was rejected deliberately: "Set
// Name" contains "name", and would have become the player.
//
// AMBIGUITY IS SHOWN, NEVER RESOLVED BY GUESS. A bare "Price" is the cost in one
// file, an asking price in another and a sale price in a third; mapping it to
// any of them silently puts wrong money on every card. It is not imported until
// a person says which it is.
//
// Pure. No I/O, safe on the client. The server action re-applies the money and
// condition rules itself, because the client can be bypassed.

/** The fields `importCards` writes, in the order a person reads them. */
export const IMPORT_FIELDS = [
  "player", "year", "set_name", "card_number", "parallel", "sport_category",
  "condition_type", "grader", "grade", "market_value", "individual_basis",
  "status", "zone", "location_code",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABEL: Record<ImportField, string> = {
  player: "Player / name",
  year: "Year",
  set_name: "Set",
  card_number: "Card #",
  parallel: "Parallel",
  sport_category: "Category",
  condition_type: "Raw or graded",
  grader: "Grader",
  grade: "Grade",
  market_value: "Market value",
  individual_basis: "Cost (what you paid)",
  status: "Status",
  zone: "Zone",
  location_code: "Location",
};

/**
 * A row needs at least one of these to be a card at all. Without any, it is a
 * blank SKU — which is what every unrecognised file used to produce.
 */
export const IDENTITY_FIELDS: ImportField[] = ["player", "set_name", "card_number", "year"];

/**
 * Header words per field, in their NORMALISED form (see `normalizeHeader`).
 *
 * Each list is generic inventory vocabulary. Words left out on purpose:
 * "brand" (Topps is not a set), "type" (Whatnot uses it for "Buy it Now"),
 * "color", "card id" (usually a database key, not the printed number), and
 * every bare money word — see AMBIGUOUS.
 */
const SYNONYMS: Record<ImportField, string[]> = {
  player: ["player", "player name", "name", "card name", "subject", "character", "athlete"],
  year: ["year", "season", "release year", "card year", "yr"],
  set_name: ["set", "set name", "product", "series", "release", "expansion", "card set", "set title"],
  card_number: ["card number", "card #", "card no", "card num", "number", "#", "no", "num", "collector number"],
  parallel: ["parallel", "variation", "variant", "insert", "finish", "parallel name"],
  sport_category: ["sport", "category", "sport category", "game", "tcg"],
  condition_type: ["condition type", "raw or graded", "graded or raw", "raw graded", "graded raw", "graded"],
  grader: ["grader", "grading company", "grading co", "company", "grading service", "tpg", "graded by"],
  grade: ["grade", "card grade", "numeric grade", "psa grade", "bgs grade", "sgc grade", "cgc grade"],
  market_value: [
    "market value", "value", "current value", "est value", "estimated value", "fmv",
    "fair market value", "market price", "current price", "worth",
  ],
  individual_basis: [
    "cost", "cost basis", "basis", "purchase price", "price paid", "paid", "amount paid",
    "buy price", "bought for", "acquisition cost", "purchase cost", "individual basis",
  ],
  status: ["status"],
  zone: ["zone"],
  location_code: ["location", "location code", "storage", "storage location", "box", "bin", "shelf", "slot"],
};

/** Headers that look mappable and must not be guessed at. */
const AMBIGUOUS: Record<string, string> = {
  "price": "Could be what you paid, an asking price or a sale price. Pick which one, or it isn't imported.",
  "condition": "Could mean raw-vs-graded or a condition like NM. CardOps stores raw/graded — pick it explicitly if that's what this is.",
  "sale price": "A sale price. Cards import as unsold; record the sale through the sell flow afterwards.",
  "sold price": "A sale price. Cards import as unsold; record the sale through the sell flow afterwards.",
  "sold for": "A sale price. Cards import as unsold; record the sale through the sell flow afterwards.",
  "title": "A full listing title. It can't be split into player / set / year reliably — map the separate columns if you have them.",
  "description": "Free text. Not split into fields; map the separate columns if you have them.",
};

/** Lowercase, punctuation to spaces, `#` kept as its own token. */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/#/g, " # ")
    .replace(/[^a-z0-9# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Quote-aware split of a whole file on one delimiter.
 *
 * Not `paste-sales`' splitter: that one splits first and strips quotes after,
 * which is right for a table pasted from a web page and wrong for a CSV, where
 * `"Topps Chrome, Refractor"` is ONE field.
 */
function parseWith(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); field = ""; row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // A line that is nothing but delimiters or whitespace is not a record.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Pick the delimiter by CONSISTENCY across rows, quote-aware.
 *
 * European Excel saves with semicolons and a sheet copied out of Google Sheets
 * arrives tab-separated; guessing comma for both loads one giant column.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const rows = parseWith(sample, d).slice(0, 20);
    if (rows.length < 1) continue;
    const counts = rows.map((r) => r.length);
    const head = counts[0];
    if (head < 2) continue;
    const agree = counts.filter((c) => c === head).length / counts.length;
    const score = agree * 100 + head;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export type ParsedFile = { headers: string[]; rows: string[][]; delimiter: string };

/** Header row plus data rows, every row padded to the header's width. */
export function parseFile(text: string): ParsedFile {
  const clean = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);
  const all = parseWith(clean, delimiter);
  if (!all.length) return { headers: [], rows: [], delimiter };
  const headers = all[0].map((h) => h.trim());
  const rows = all.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, rows, delimiter };
}

// ── Proposing a mapping ────────────────────────────────────────────────────

export type Mapped = { col: number; header: string; how: "exact" | "likely" };

export type Proposal = {
  /** Field → column. Absent means nothing in the file was recognised for it. */
  map: Partial<Record<ImportField, Mapped>>;
  /** Columns the file has that CardOps will not import as proposed. */
  unmapped: { col: number; header: string; note?: string }[];
  /** Columns that look relevant but must be chosen by a person. */
  ambiguous: { col: number; header: string; why: string }[];
};

/**
 * A column that counts 1, 2, 3… is a spreadsheet's row number, not a card
 * number, however its header is labelled. "#" and "No." head row counters as
 * often as they head card numbers.
 */
export function looksLikeRowIndex(values: string[]): boolean {
  const v = values.map((x) => x.trim()).filter((x) => x !== "");
  if (v.length < 3) return false;
  if (!v.every((x) => /^\d+$/.test(x))) return false;
  const n = v.map(Number);
  if (n[0] !== 0 && n[0] !== 1) return false;
  return n.every((x, i) => x === n[0] + i);
}

/**
 * Propose which column feeds which field.
 *
 * Exact beats likely; on a tie the left-most column wins and the other is
 * reported as unmapped rather than dropped, so a second "Name" column is
 * visible instead of silently ignored.
 */
export function proposeMapping(headers: string[], rows: string[][] = []): Proposal {
  const map: Proposal["map"] = {};
  const unmapped: Proposal["unmapped"] = [];
  const ambiguous: Proposal["ambiguous"] = [];

  headers.forEach((header, col) => {
    const n = normalizeHeader(header);
    if (!n) { unmapped.push({ col, header }); return; }

    let field: ImportField | null = null;
    let how: Mapped["how"] = "likely";
    for (const f of IMPORT_FIELDS) {
      if (n === f.replace(/_/g, " ")) { field = f; how = "exact"; break; }
    }
    if (!field) {
      for (const f of IMPORT_FIELDS) {
        if (SYNONYMS[f].includes(n)) { field = f; break; }
      }
    }

    if (!field) {
      if (AMBIGUOUS[n]) ambiguous.push({ col, header, why: AMBIGUOUS[n] });
      else unmapped.push({ col, header });
      return;
    }

    if (field === "card_number" && looksLikeRowIndex(rows.map((r) => r[col] ?? ""))) {
      ambiguous.push({ col, header, why: "Counts 1, 2, 3… down the file — that's a row number, not a card number." });
      return;
    }

    const prior = map[field];
    if (!prior || (how === "exact" && prior.how !== "exact")) {
      if (prior) unmapped.push({ col: prior.col, header: prior.header, note: `also looked like ${FIELD_LABEL[field]}` });
      map[field] = { col, header, how };
    } else {
      unmapped.push({ col, header, note: `also looked like ${FIELD_LABEL[field]}` });
    }
  });

  unmapped.sort((a, b) => a.col - b.col);
  return { map, unmapped, ambiguous };
}

/** The editable form of a proposal: field → column index, or null for "skip". */
export type Mapping = Record<ImportField, number | null>;

export function toMapping(p: Proposal): Mapping {
  return Object.fromEntries(IMPORT_FIELDS.map((f) => [f, p.map[f]?.col ?? null])) as Mapping;
}

/** Can anything useful be imported at all with this mapping? */
export function mappingProblem(m: Mapping): string | null {
  if (IDENTITY_FIELDS.every((f) => m[f] == null)) {
    return "Nothing in this file maps to a player, set, card number or year, so every row would become a blank card. Choose at least one of those columns below.";
  }
  return null;
}

// ── Values ─────────────────────────────────────────────────────────────────

/**
 * Which way round a money column writes its separators.
 *
 * `us`   — 1,234.50  (comma groups thousands, dot is the decimal)
 * `eu`   — 1.234,50  (dot groups thousands, comma is the decimal)
 * `auto` — decide per cell, for a single value with no column to go on
 *
 * This matters more than it looks. Stripping every comma — the obvious
 * implementation, and the first one written here — reads a European "12,50" as
 * TWELVE HUNDRED AND FIFTY, a hundredfold error with nothing flagged, and reads
 * "1.234" (one thousand two hundred and thirty-four) as $1.23.
 */
export type MoneyStyle = "us" | "eu" | "auto";

/**
 * Read a column's convention from its own values. One cell with a decimal comma
 * ("12,50", "1.234,00") settles it: a US file never writes those, because a US
 * thousands group is always three digits.
 */
export function detectMoneyStyle(values: string[]): "us" | "eu" {
  return values.some((v) => /\d,\d{1,2}\s*$/.test(v.trim()) || /\d\.\d{3},\d/.test(v)) ? "eu" : "us";
}

/**
 * A money cell as a plain decimal string, "" when empty, or null when the cell
 * has something in it that is not a readable amount.
 *
 * NULL IS NOT ZERO. "$12.50" used to fail `Number()` and land as a cost of 0
 * flagged un-entered; a cell that genuinely says "0" must stay a stated zero,
 * because `basis_entered` turns on the difference (rule 9: a missing price is a
 * failure, never $0).
 *
 * Only dollars are read. "€12" and "£5" come back null and are reported rather
 * than imported as dollars — CardOps keeps money in USD, and the number alone
 * says nothing about which currency it was.
 */
export function parseMoney(v: string | null | undefined, style: MoneyStyle = "auto"): string | null {
  if (v == null) return "";
  const s = String(v).trim();
  if (s === "") return "";
  let t = s.replace(/^(usd|us\$)\s*/i, "").replace(/\s*usd$/i, "").replace(/[$\s]/g, "");

  if (style === "eu") {
    t = t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  } else if (style === "us") {
    if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(t) && !/^\d+(\.\d+)?$/.test(t)) return null;
    t = t.replace(/,/g, "");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
    t = t.replace(/,/g, "");                                  // 1,234.50
  } else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");               // 1.234,50
  } else if (/^\d+,\d{1,2}$/.test(t)) {
    t = t.replace(",", ".");                                  // 12,50
  }
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
}

/** The print year: the first four-digit run in a plausible range ("2021-22" → "2021"). */
export function parseYear(v: string): string | null {
  const s = v.trim();
  if (!s) return "";
  const m = /(?:^|\D)(1[89]\d\d|20\d\d)(?:\D|$)/.exec(s);
  return m ? m[1] : null;
}

const GRADERS = ["PSA", "BGS", "BVG", "SGC", "CGC", "TAG", "HGA", "CSG", "ISA", "KSA"];

/**
 * A grade cell, split into grader and number when it carries both ("PSA 10",
 * "BGS 9.5"). Returns null for the grade when no standalone number is present.
 */
export function parseGrade(v: string): { grade: string | null; grader: string | null } {
  const s = v.trim();
  if (!s) return { grade: "", grader: null };
  const g = new RegExp(`^(${GRADERS.join("|")})\\b`, "i").exec(s);
  // One decimal place, not just halves: TAG and some CGC labels print 9.8, and
  // "10.0" is common. The leading space-or-start keeps a year in the wrong
  // column ("2021") from reading as grade 21.
  const num = /(?:^|\s)(\d{1,2}(?:\.\d)?)\s*$/.exec(s);
  return { grade: num ? num[1] : null, grader: g ? g[1].toUpperCase() : null };
}

const CONDITION_VALUES: Record<string, "raw" | "graded"> = {
  raw: "raw", ungraded: "raw", no: "raw", n: "raw", false: "raw", "0": "raw",
  graded: "graded", slab: "graded", slabbed: "graded", yes: "graded", y: "graded", true: "graded", "1": "graded",
};

/** Category spellings onto the values the rest of the app keys on. */
const CATEGORY_VALUES: Record<string, string> = {
  football: "Football", nfl: "Football",
  basketball: "Basketball", nba: "Basketball", wnba: "Basketball",
  baseball: "Baseball", mlb: "Baseball",
  hockey: "Hockey", nhl: "Hockey",
  soccer: "Soccer", mls: "Soccer", futbol: "Soccer",
  pokemon: "Pokemon", "pokémon": "Pokemon", ptcg: "Pokemon",
  mtg: "MTG", magic: "MTG", "magic the gathering": "MTG",
  "lol tcg": "LoL TCG", riftbound: "LoL TCG",
  other: "Other",
};

export type ValueIssue = { field: ImportField; count: number; examples: string[] };

/**
 * Turn file rows into the canonical rows `importCards` accepts.
 *
 * Values that cannot be read are left blank and COUNTED per field, never
 * guessed at and never dropped silently (rule 10).
 */
export function applyMapping(rows: string[][], m: Mapping): { cards: Record<string, string>[]; issues: ValueIssue[]; identityless: number } {
  const issues = new Map<ImportField, ValueIssue>();
  const note = (field: ImportField, raw: string) => {
    const it = issues.get(field) ?? { field, count: 0, examples: [] };
    it.count++;
    if (it.examples.length < 3 && !it.examples.includes(raw)) it.examples.push(raw);
    issues.set(field, it);
  };

  // One convention per money COLUMN, read from that column's own values, so
  // "1.234" in a column that elsewhere writes "5,00" is read the European way.
  const styleOf: Partial<Record<ImportField, "us" | "eu">> = {};
  for (const f of ["market_value", "individual_basis"] as const) {
    const col = m[f];
    if (col != null) styleOf[f] = detectMoneyStyle(rows.map((r) => r[col] ?? ""));
  }

  let identityless = 0;
  const cards = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const f of IMPORT_FIELDS) {
      const col = m[f];
      if (col == null) continue;
      out[f] = (row[col] ?? "").trim();
    }

    if (out.year != null) {
      const y = parseYear(out.year);
      if (y === null) { note("year", out.year); out.year = ""; } else out.year = y;
    }
    for (const f of ["market_value", "individual_basis"] as const) {
      if (out[f] == null) continue;
      const v = parseMoney(out[f], styleOf[f] ?? "auto");
      if (v === null) { note(f, out[f]); out[f] = ""; } else out[f] = v;
    }
    if (out.grade != null) {
      const { grade, grader } = parseGrade(out.grade);
      if (grade === null) { note("grade", out.grade); out.grade = ""; } else out.grade = grade;
      // "PSA 10" in one column: the grader travels too, unless a grader column
      // was mapped and says something of its own.
      if (grader && !out.grader) out.grader = grader;
    }
    if (out.condition_type != null && out.condition_type !== "") {
      const c = CONDITION_VALUES[out.condition_type.toLowerCase()];
      // Left blank rather than passed through: an unrecognised value such as
      // "NM" would fail the raw/graded CHECK and reject the WHOLE batch.
      if (!c) { note("condition_type", out.condition_type); out.condition_type = ""; } else out.condition_type = c;
    }
    if (out.sport_category) {
      const c = CATEGORY_VALUES[out.sport_category.toLowerCase()];
      if (c) out.sport_category = c;
    }
    if (out.status) out.status = out.status.toLowerCase();

    if (IDENTITY_FIELDS.every((f) => !out[f])) identityless++;
    return out;
  });

  return { cards, issues: [...issues.values()], identityless };
}

/** True when a canonical row has nothing that identifies a card. */
export function isIdentityless(r: Record<string, string | undefined>): boolean {
  return IDENTITY_FIELDS.every((f) => !(r[f] ?? "").trim());
}

// ── Server-side coercion ────────────────────────────────────────────────────
//
// The same rules the client applies, run again by `importCards`, because the
// client can be bypassed and the server action is what writes. They live here
// rather than in `actions.ts` because a "use server" module may only export
// async functions.

/** Largest single money figure an import will accept, matching the old guard. */
export const MONEY_CEILING = 10_000_000;

/**
 * A money cell as a number, or null when it is empty, unreadable, negative or
 * implausibly large. NULL means "not stated" — never zero.
 */
export function moneyNumber(v: string | null | undefined): number | null {
  const s = parseMoney(v);
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= MONEY_CEILING ? n : null;
}

/**
 * Did this row STATE a cost — including a cost of zero?
 *
 * `basis_entered` turns on exactly this. A blank or unreadable cell must leave
 * the card flagged as un-costed rather than reading as free; a cell that says
 * "0" or "$0.00" is a stated zero and is recorded as one.
 */
export function basisStated(v: string | null | undefined): boolean {
  return moneyNumber(v) !== null;
}

/**
 * Raw or graded, inferring GRADED from a grader when the row didn't say.
 *
 * The old default was "raw" regardless, so a row with grader PSA and grade 10
 * but no condition column became a RAW card holding a PSA grade — and pricing
 * keys on `condition_type`, so it was valued off ungraded comps. An
 * unrecognised value ("NM") falls back to the same inference rather than
 * failing the raw/graded CHECK and rejecting the whole batch; the client has
 * already reported such cells before the import was confirmed.
 */
export function importCondition(r: Record<string, string | undefined>): "raw" | "graded" {
  const stated = CONDITION_VALUES[(r.condition_type ?? "").trim().toLowerCase()];
  if (stated) return stated;
  return (r.grader ?? "").trim() ? "graded" : "raw";
}
