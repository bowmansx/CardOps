import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { BookingSimulator } from "@/components/cards/BookingSimulator";

export const dynamic = "force-dynamic";

// Card Booking Simulator (Beau, 2026-07-21) — the "trust-simulator" for cards.
// Model how the SAME cards come out under every funding path (keep personal /
// sell to the entity / advance as a loan / contribute as capital) and every tax
// treatment, side by side, WITHOUT posting anything. Decision-support only — NOT
// tax advice. Owner-only (entities are owner-gated).
export default async function SimulatorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if ((await currentRole()) !== "owner") redirect("/cards");

  const { data: ents } = await supabase
    .from("card_businesses")
    .select("id, name, short_code, type, zoho_books_org_id")
    .eq("active", true)
    .order("short_code");

  return <BookingSimulator entities={(ents ?? []) as never} />;
}
