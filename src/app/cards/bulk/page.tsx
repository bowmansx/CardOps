import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BUILTIN_PROFILES } from "@/lib/cards/export";
import { BulkManager } from "@/components/cards/BulkManager";

export const dynamic = "force-dynamic";

// Bulk manager: select many cards → change status/storage/strategy in one
// shot, or export exactly the selection to any format profile.
export default async function BulkPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("cards")
    .select("id, sku, player, year, set_name, card_number, sport_category, status, storage_location, location_code, condition_type, grader, grade, manual_price, market_value")
    .not("status", "in", "(archived,sold)")
    .order("created_at", { ascending: false })
    .limit(1000);

  const { data: dbProfiles } = await supabase
    .from("card_format_profiles")
    .select("name")
    .in("direction", ["export", "both"])
    .eq("active", true)
    .order("name");
  const names = new Set((dbProfiles ?? []).map((p) => p.name as string));
  const profiles = [
    ...(dbProfiles ?? []).map((p) => p.name as string),
    ...Object.keys(BUILTIN_PROFILES).filter((n) => !names.has(n)),
  ];

  const { data: strategies } = await supabase
    .from("card_pricing_strategies")
    .select("key")
    .order("key");

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-3xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bulk actions</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <BulkManager
          cards={(rows ?? []) as never}
          profiles={profiles}
          strategies={(strategies ?? []).map((s) => s.key as string)}
        />
      </div>
    </main>
  );
}
