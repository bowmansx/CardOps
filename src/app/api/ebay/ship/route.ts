import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { shipOrder } from "@/lib/ebay/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mark an order shipped with tracking — buyer gets eBay's shipped email.
// POST { orderId, carrier, tracking }
const CARRIERS = new Set(["USPS", "UPS", "FedEx", "DHL", "Other"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { orderId?: string; carrier?: string; tracking?: string }
    | null;
  const tracking = body?.tracking?.trim();
  if (!body?.orderId || !body.carrier || !CARRIERS.has(body.carrier) || !tracking) {
    return NextResponse.json({ error: "orderId, carrier (USPS/UPS/FedEx/DHL/Other), tracking required." }, { status: 400 });
  }

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const r = await shipOrder(access, body.orderId, body.carrier, tracking);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  await supabase.from("audit_log").insert({
    actor: "web", action: "ebay_shipped", target: body.orderId,
    payload: { carrier: body.carrier, tracking }, result: "ok",
  }).then(() => {}, () => {});
  return NextResponse.json({ ok: true });
}
