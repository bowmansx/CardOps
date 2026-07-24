import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { getMemberMessages, replyToMemberMessage } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Buyer↔seller messages. GET = recent inbox (14 days).
// POST { op: "reply", itemId, parentMessageId, recipientId, body }
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
  const r = await getMemberMessages(g.access, 14);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ messages: r.messages });
}

export async function POST(request: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const body = (await request.json().catch(() => null)) as
    | { op?: string; itemId?: string; parentMessageId?: string; recipientId?: string; body?: string }
    | null;
  const text = body?.body?.trim();
  if (body?.op !== "reply") return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  if (!body.itemId || !body.parentMessageId || !body.recipientId || !text) {
    return NextResponse.json({ error: "itemId, parentMessageId, recipientId, body required." }, { status: 400 });
  }
  const r = await replyToMemberMessage(g.access, body.itemId, body.parentMessageId, body.recipientId, text);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
