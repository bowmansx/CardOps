import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { getReceivedFeedback, leaveFeedback, replyToFeedback } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Seller feedback ("reviews"). GET = your received feedback + score.
// POST { op: "leave", itemId, targetUser, text }   → thank a buyer (ItemID = the listing)
// POST { op: "reply", feedbackId, targetUser, text } → reply to a comment
async function gate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if ((await currentRole()) !== "owner") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  const access = await getEbayAccess(supabase);
  if (!access) return { error: NextResponse.json({ error: "eBay not connected." }, { status: 503 }) };
  return { supabase, access };
}

export async function GET() {
  const g = await gate();
  if ("error" in g) return g.error;
  const r = await getReceivedFeedback(g.access);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r.data);
}

export async function POST(request: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const body = (await request.json().catch(() => null)) as
    | { op?: string; itemId?: string; targetUser?: string; text?: string; feedbackId?: string }
    | null;
  const text = body?.text?.trim();

  if (body?.op === "leave") {
    if (!body.itemId || !body.targetUser || !text) {
      return NextResponse.json({ error: "itemId, targetUser, text required." }, { status: 400 });
    }
    const r = await leaveFeedback(g.access, body.itemId, body.targetUser, text);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  if (body?.op === "reply") {
    if (!body.feedbackId || !body.targetUser || !text) {
      return NextResponse.json({ error: "feedbackId, targetUser, text required." }, { status: 400 });
    }
    const r = await replyToFeedback(g.access, body.feedbackId, body.targetUser, text);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
