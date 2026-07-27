import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { readAllSafe } from "@/lib/supabase/page";
import { findMatches, confidenceOf, type MatchQuery } from "@/lib/cards/match";

export const dynamic = "force-dynamic";

// FIND: "which card in my inventory is this?" (Beau, 2026-07-26 —
//   "i'd also like an option when taking a photo to do a 'search for card'")
//
// FREE. The photo has already been through /api/cards/intake/scan by the time
// it reaches here, so this route spends nothing: it is a comparison against
// rows the caller already owns. Charging for it would be charging for data we
// don't fetch.
//
// Text works too. The same endpoint answers a typed query, which is what makes
// FIND usable when the card is in a case, in a binder page, or already boxed
// for a grader.
//
// POST { player?, year?, set_name?, card_number?, parallel?, serial_number?,
//        cert_number?, grader?, grade? }  →  { matches, truncated }

type Row = {
  id: string; sku: string | null; status: string | null;
  player: string | null; year: number | null; set_name: string | null;
  card_number: string | null; parallel: string | null;
  serial_number: string | null; cert_number: string | null;
  grader: string | null; grade: number | null;
  market_value: number | null;
};

const FIELDS =
  "id, sku, status, player, year, set_name, card_number, parallel, serial_number, cert_number, grader, grade, market_value";

// A collection this size is already past what a person can hold in their head;
// beyond it the answer is "narrow it down", not a longer list read slowly.
const CAP = 20000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as (MatchQuery & { includeSold?: boolean }) | null;
  if (!body) return NextResponse.json({ error: "Send something to search for." }, { status: 400 });

  const q: MatchQuery = {
    player: body.player, year: body.year, set_name: body.set_name,
    card_number: body.card_number, parallel: body.parallel,
    serial_number: body.serial_number, cert_number: body.cert_number,
    grader: body.grader, grade: body.grade,
  };

  // Every row, paged. Matching is a scan — a bare .limit() would silently stop
  // at 1000 and report "no match" for a card sitting at row 1200 (rule 5).
  // RLS scopes it: this is the caller's own client, never the service role.
  const { rows, truncated, error } = await readAllSafe<Row>(
    (from, to) => {
      let sel = supabase.from("cards").select(FIELDS);
      // Sold cards are a separate section by design; a card you no longer own
      // is not what you are holding up to the camera. Findable on request.
      if (!body.includeSold) sel = sel.neq("status", "sold");
      return sel.order("created_at", { ascending: false }).order("id").range(from, to) as unknown as
        PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
    },
    CAP,
  );

  // A failed page is not an empty inventory. Saying "no match" here would send
  // someone to re-book a card they already own (rules 3 and 4).
  if (error) {
    return NextResponse.json(
      { error: `Couldn't read your inventory — ${error}. Nothing was searched.` },
      { status: 502 },
    );
  }

  const matches = findMatches(rows, q).map((m) => ({
    ...m.card,
    score: Math.round(m.score * 100) / 100,
    confidence: confidenceOf(m),
    reasons: m.reasons,
    conflicts: m.conflicts,
  }));

  return NextResponse.json({
    matches,
    searched: rows.length,
    // Silent truncation reads as "covered everything" (rule 10).
    truncated,
  });
}
