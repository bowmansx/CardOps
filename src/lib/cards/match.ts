// FIND: "which card in MY inventory is this?" (Beau, 2026-07-26)
//
//   "i'd also like an option when taking a photo to do a 'search for card'"
//   "i do like the idea of maybe having an option for 'update' when taking a
//    photo... say i'm sending out 10 cards for grading"
//
// Intake asks a different question — "what card is this?" — and answers it from
// the photo. FIND asks "which of the ones I already own is this?", and the
// photo is only the query. So the vision pass is reused as-is and everything
// here is a pure, free, testable comparison against rows the user already has.
//
// WHY SCORING RATHER THAN A QUERY. An exact WHERE returns nothing the moment
// vision reads "Prizm" against a row typed as "Panini Prizm", or reads a year
// off a copyright line as 2021 when the card is filed under 2022. A collector
// pointing a phone at a card in their own hand knows perfectly well which card
// it is; the app's job is to put the right row near the top, not to be right
// on the first try and silent otherwise.
//
// NOTHING HERE DECIDES. A score is an ordering, never a verdict — the caller
// shows the candidates and the person picks. That matters most for the case
// this exists to serve: sending ten cards to a grader, where updating the WRONG
// row is worse than updating none.

export type MatchQuery = {
  player?: string | null;
  year?: string | number | null;
  set_name?: string | null;
  card_number?: string | null;
  parallel?: string | null;
  serial_number?: string | null;
  cert_number?: string | null;
  grader?: string | null;
  grade?: string | number | null;
  is_auto?: boolean | null;
  is_relic?: boolean | null;
};

export type MatchCard = MatchQuery & { id: string; sku?: string | null; status?: string | null };

export type Scored<T> = {
  card: T;
  /** 0..1. Not a probability — an ordering. */
  score: number;
  /** Which fields agreed, in plain words, so a screen can show its work. */
  reasons: string[];
  /** Fields where both sides had a value and they disagreed. */
  conflicts: string[];
  /** A signal unique enough to stand alone (cert or serial number). */
  decisive: boolean;
  /** How many of the agreeing fields actually NARROW the inventory. */
  identifying: number;
};

/** Lowercase, strip punctuation and filler, squeeze spaces. */
export function norm(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Card numbers: "RC-12", "#12", "012" and "12" are the same number. */
export function normNumber(v: unknown): string {
  const s = norm(v).replace(/\s+/g, "");
  if (!s) return "";
  // Keep any letter prefix (RC12 stays distinct from 12) but drop leading
  // zeros on the digits, which are a printing choice rather than an identity.
  const m = /^([a-z]*)0*(\d+)$/.exec(s);
  return m ? `${m[1]}${m[2]}` : s;
}

/**
 * Set names are the messiest field in the system. Vision reads what is printed
 * on the card; a person types what they call it. "Panini Prizm" / "Prizm" /
 * "2022 Prizm Football" are one set, and no exact comparison sees that.
 *
 * Containment either way counts as a hit, once both sides have had the words
 * that carry no information removed.
 */
const SET_NOISE = new Set(["the", "series", "set", "edition", "collection", "cards", "card"]);

/**
 * Manufacturers. A brand name is not a set — "Topps Chrome" and "Topps Series
 * 1" are different products that share nothing but a company, and containment
 * alone would happily call them equal.
 */
const BRANDS = new Set([
  "topps", "panini", "bowman", "fleer", "donruss", "leaf", "score", "sage",
  "upper", "deck", "wizards", "coast", "pokemon", "nintendo", "riot",
]);

export function setWords(v: unknown): string[] {
  return norm(v).split(" ").filter((w) => w.length > 2 && !SET_NOISE.has(w));
}

export function setsAgree(a: unknown, b: unknown): boolean {
  const x = setWords(a), y = setWords(b);
  if (!x.length || !y.length) return false;
  const small = x.length <= y.length ? x : y;
  const big = new Set(x.length <= y.length ? y : x);
  // Containment either way, but the overlap has to carry a word that actually
  // names a product — otherwise every Topps card matches every other one.
  return small.every((w) => big.has(w)) && small.some((w) => !BRANDS.has(w));
}

/** Names: "Ja'Marr Chase" vs "Chase, Ja'Marr" vs "JaMarr Chase". */
export function namesAgree(a: unknown, b: unknown): boolean {
  const x = norm(a).split(" ").filter(Boolean);
  const y = norm(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  // A surname match plus a first initial is enough — it is the only pair of
  // tokens both spellings reliably share.
  const surname = (t: string[]) => t[t.length - 1];
  if (surname(x) !== surname(y)) return false;
  const first = (t: string[]) => (t.length > 1 ? t[0][0] : "");
  return first(x) === first(y) || !first(x) || !first(y);
}

// What each agreeing field is worth. Cert and serial dominate because they are
// the only fields printed once in the world; everything else repeats across
// thousands of copies.
const WEIGHTS = {
  cert_number: 60,
  serial_number: 30,
  card_number: 14,
  set_name: 14,
  player: 16,
  year: 8,
  parallel: 6,
  grade: 6,
} as const;

/**
 * The fields that NARROW an inventory, as opposed to merely corroborating.
 *
 * The distinction earns its keep on the ratio score: a query that could only be
 * compared on one field scores 1.0 on it, so "2021" alone would match every
 * 2021 card in the collection perfectly. Year, parallel and grade can confirm a
 * candidate; none of them can find one.
 */
const IDENTIFYING = new Set(["cert_number", "serial_number", "card_number", "set_name", "player"]);

const LABEL: Record<string, string> = {
  cert_number: "cert number",
  serial_number: "serial number",
  card_number: "card number",
  set_name: "set",
  player: "player",
  year: "year",
  parallel: "parallel",
  grade: "grade",
};

/**
 * Score one candidate against the query.
 *
 * ONLY FIELDS BOTH SIDES HAVE COUNT — for or against. A blank in either one is
 * an absence of evidence: vision returns empty strings for anything it could
 * not read, and penalising a candidate because the photo was too glossy to
 * read its serial would bury the right card. The score is therefore a fraction
 * of what was actually COMPARABLE, so a match on two shared fields out of two
 * does not score below a match on four out of eight.
 */
export function scoreCard<T extends MatchCard>(card: T, q: MatchQuery): Scored<T> {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  let got = 0;
  let possible = 0;
  let decisive = false;
  let identifying = 0;

  const compare = (key: keyof typeof WEIGHTS, agree: boolean, both: boolean) => {
    if (!both) return;
    possible += WEIGHTS[key];
    if (agree) {
      got += WEIGHTS[key];
      reasons.push(LABEL[key]);
      if (IDENTIFYING.has(key)) identifying++;
      if (key === "cert_number" || key === "serial_number") decisive = true;
    } else {
      conflicts.push(LABEL[key]);
    }
  };

  const bothHave = (a: unknown, b: unknown) => !!norm(a) && !!norm(b);

  // Certs are printed with and without dashes, so they compare like numbers.
  compare("cert_number", normNumber(card.cert_number) === normNumber(q.cert_number), bothHave(card.cert_number, q.cert_number));
  compare("serial_number", normNumber(card.serial_number) === normNumber(q.serial_number), bothHave(card.serial_number, q.serial_number));
  compare("card_number", normNumber(card.card_number) === normNumber(q.card_number), bothHave(card.card_number, q.card_number));
  compare("set_name", setsAgree(card.set_name, q.set_name), bothHave(card.set_name, q.set_name));
  compare("player", namesAgree(card.player, q.player), bothHave(card.player, q.player));
  compare("year", norm(card.year) === norm(q.year), bothHave(card.year, q.year));
  compare("parallel", norm(card.parallel) === norm(q.parallel), bothHave(card.parallel, q.parallel));
  compare("grade", norm(card.grade) === norm(q.grade) && norm(card.grader) === norm(q.grader), bothHave(card.grade, q.grade));

  // A cert number that MATCHES is the whole answer; a cert number that
  // CONFLICTS is the whole answer too, in the other direction. Two slabs
  // cannot share one, so no amount of agreement elsewhere survives it.
  if (conflicts.includes("cert number")) return { card, score: 0, reasons, conflicts, decisive: false, identifying: 0 };

  return {
    card,
    score: possible > 0 ? got / possible : 0,
    reasons,
    conflicts,
    decisive,
    identifying,
  };
}

/** How sure we are, in words. Never a number pretending to be a probability. */
export type Confidence = "certain" | "likely" | "possible";

export function confidenceOf(s: Scored<MatchCard>): Confidence {
  if (s.decisive && !s.conflicts.length) return "certain";
  if (s.score >= 0.8 && s.reasons.length >= 3 && !s.conflicts.length) return "likely";
  return "possible";
}

/**
 * Rank the user's cards against a query.
 *
 * TWO GATES, AND BOTH MATTER. Below `floor` the candidate agreed on too small a
 * share of what could be compared. Without an IDENTIFYING agreement it agreed
 * on nothing that narrows anything — an inventory of two thousand cards always
 * contains something that shares a year, and it would score a perfect 1.0 if a
 * year were all the photo could be compared on.
 *
 * Offering those is worse than saying nothing: it invites a wrong pick on the
 * exact flow this exists for (ten cards out to a grader), where a wrong pick is
 * expensive and quiet.
 */
export function findMatches<T extends MatchCard>(
  cards: T[],
  q: MatchQuery,
  { limit = 8, floor = 0.5 } = {},
): Scored<T>[] {
  const anyQuery = Object.values(q).some((v) => (typeof v === "boolean" ? false : !!norm(v)));
  if (!anyQuery) return [];
  return cards
    .map((c) => scoreCard(c, q))
    .filter((s) => s.score >= floor && (s.decisive || s.identifying > 0))
    // Decisive first, then score, then id so the order never wobbles between
    // two identical scores.
    .sort((a, b) =>
      Number(b.decisive) - Number(a.decisive) ||
      b.score - a.score ||
      b.reasons.length - a.reasons.length ||
      String(a.card.id).localeCompare(String(b.card.id)))
    .slice(0, limit);
}
