import { createClient } from "@/lib/supabase/server";
import { ShowMode } from "@/components/cards/ShowMode";

export const dynamic = "force-dynamic";

// Show mode — the card-store flex screen. Big photos, no admin chrome,
// prices toggleable (hide them when a buyer is looking over your shoulder).
export default async function ShowPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("cards")
    .select("id, player, year, set_name, parallel, card_number, sport_category, grader, grade, condition_type, serial_number, is_rookie, is_auto, is_relic, manual_price, market_value")
    .not("status", "in", "(sold,archived)")
    .order("created_at", { ascending: false })
    .limit(200);
  const cards = rows ?? [];

  // Front photos → 24h signed URLs, batched in one storage call per bucket.
  const ids = cards.map((c) => c.id as string);
  const photoByCard = new Map<string, string>();
  if (ids.length) {
    const { data: photos } = await supabase
      .from("card_photos")
      .select("card_id, kind, bucket, path, created_at")
      .in("card_id", ids)
      .order("created_at", { ascending: false });
    // newest front per card; fall back to the newest of any kind
    const front = new Map<string, { bucket: string; path: string }>();
    const any = new Map<string, { bucket: string; path: string }>();
    for (const p of photos ?? []) {
      const id = p.card_id as string;
      const loc = { bucket: p.bucket as string, path: p.path as string };
      if (p.kind === "front" && !front.has(id)) front.set(id, loc);
      if (!any.has(id)) any.set(id, loc);
    }
    const pick = new Map([...any, ...front]);
    const byBucket = new Map<string, { id: string; path: string }[]>();
    for (const [id, { bucket, path }] of pick) {
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket)!.push({ id, path });
    }
    for (const [bucket, entries] of byBucket) {
      const { data: signed } = await supabase.storage
        .from(bucket)
        .createSignedUrls(entries.map((e) => e.path), 24 * 3600);
      (signed ?? []).forEach((s, i) => {
        if (s.signedUrl) photoByCard.set(entries[i].id, s.signedUrl);
      });
    }
  }

  return (
    <ShowMode
      cards={cards.map((c) => ({
        id: c.id as string,
        title: [c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(untitled)",
        subtitle: [c.parallel, c.card_number ? `#${c.card_number}` : null].filter(Boolean).join(" · "),
        category: (c.sport_category as string) ?? null,
        grade: c.condition_type === "graded" ? `${c.grader ?? ""} ${c.grade ?? ""}`.trim() : null,
        chips: [
          c.is_rookie ? "RC" : null,
          c.is_auto ? "AUTO" : null,
          c.is_relic ? "PATCH" : null,
          c.serial_number ? `#'d ${c.serial_number}` : null,
        ].filter(Boolean) as string[],
        price: (c.manual_price ?? c.market_value ?? null) as number | null,
        photo: photoByCard.get(c.id as string) ?? null,
      }))}
    />
  );
}
