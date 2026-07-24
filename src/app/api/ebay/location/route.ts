import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { ebayApi, LOCATION_KEY, writeEbayPrefs } from "@/lib/ebay/listing";

export const dynamic = "force-dynamic";

// One-time ship-from location (publishOffer hard-fails without one).
// POST { city, state, zip }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { city?: string; state?: string; zip?: string } | null;
  const city = body?.city?.trim();
  const state = body?.state?.trim().toUpperCase();
  const zip = body?.zip?.trim();
  if (!city || !state || !zip) return NextResponse.json({ error: "city, state, zip required." }, { status: 400 });

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const r = await ebayApi(access, "POST", `/sell/inventory/v1/location/${LOCATION_KEY}`, {
    location: {
      address: { city, stateOrProvince: state, postalCode: zip, country: "US" },
    },
    name: "CardOps ship-from",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  });
  // 409 = already exists — that's success for our purposes.
  if (!r.ok && r.status !== 409) return NextResponse.json({ error: r.error }, { status: 502 });

  // Keep the address bits — auctions (Trading API) need the PostalCode.
  await writeEbayPrefs(supabase, user.id, { location_ok: true, ship_city: city, ship_state: state, ship_zip: zip });
  return NextResponse.json({ ok: true });
}
