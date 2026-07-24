import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const money = (n: number | null) =>
  n == null ? null : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type ShowCard = {
  id: string; player: string | null; year: number | null; set_name: string | null; parallel: string | null;
  card_number: string | null; grader: string | null; grade: number | null; condition_type: string | null;
  serial_number: string | null; is_rookie: boolean | null; is_auto: boolean | null; is_relic: boolean | null;
  market_value: number | null; manual_price: number | null;
};

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = createServiceClient();
  if (!svc) return { title: "Showcase" };
  const { data } = await svc.from("card_showcases").select("title, is_public").eq("token", token).maybeSingle();
  return { title: data?.is_public ? `${data.title} · CardOps Showcase` : "Showcase" };
}

export default async function ShowcasePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = createServiceClient();
  if (!svc) notFound();

  const { data: showcase } = await svc
    .from("card_showcases")
    .select("user_id, title, card_ids, show_prices, for_sale, is_public, contact")
    .eq("token", token)
    .maybeSingle();
  if (!showcase || !showcase.is_public) notFound();

  // This page is UNAUTHENTICATED and reads with the service role, so RLS is not
  // protecting anything here — the owner filter below is the only thing keeping
  // a showcase to its own author's cards. Without it, "All live cards" (the
  // default option, stored as an empty card_ids) published every user's
  // inventory to anyone with the link, and a hand-set card_ids could name any
  // UUID at all. Both branches must be scoped. (2026-07-24)
  const ownerId = showcase.user_id as string | null;
  if (!ownerId) notFound(); // ownerless showcase predates multi-tenancy — refuse rather than leak

  const ids = (showcase.card_ids as string[]) ?? [];
  let q = svc
    .from("cards")
    .select("id, player, year, set_name, parallel, card_number, grader, grade, condition_type, serial_number, is_rookie, is_auto, is_relic, market_value, manual_price")
    .eq("user_id", ownerId)
    .not("status", "in", "(archived,sold)")
    .limit(300);
  if (ids.length) q = q.in("id", ids);
  else q = q.order("created_at", { ascending: false }).limit(200); // empty selection = all live
  const { data: cardRows } = await q;
  const cards = (cardRows ?? []) as ShowCard[];

  // Newest front photo per card → 24h signed URLs.
  const photoByCard = new Map<string, string>();
  const cardIds = cards.map((c) => c.id);
  if (cardIds.length) {
    const { data: photos } = await svc
      .from("card_photos").select("card_id, kind, bucket, path, created_at").in("card_id", cardIds).order("created_at", { ascending: false });
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
    for (const [id, { bucket, path }] of pick) (byBucket.get(bucket) ?? byBucket.set(bucket, []).get(bucket)!).push({ id, path });
    for (const [bucket, entries] of byBucket) {
      const { data: signed } = await svc.storage.from(bucket).createSignedUrls(entries.map((e) => e.path), 24 * 3600);
      (signed ?? []).forEach((s, i) => { if (s.signedUrl) photoByCard.set(entries[i].id, s.signedUrl); });
    }
  }

  const chips = (c: ShowCard) =>
    [c.is_rookie && "RC", c.is_auto && "AUTO", c.is_relic && "PATCH", c.serial_number && `/${c.serial_number}`].filter(Boolean) as string[];

  return (
    <main style={{ background: "#0b0b0d", color: "#f5f1ea", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 16px 64px" }}>
        <header style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#c9a227" }}>Showcase</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: "4px 0 0" }}>{showcase.title}</h1>
          {showcase.for_sale && (
            <div style={{ marginTop: 10, display: "inline-block", background: "rgba(201,162,39,0.15)", color: "#c9a227", borderRadius: 999, padding: "4px 14px", fontSize: 12, fontWeight: 700 }}>
              For sale{showcase.contact ? ` · ${showcase.contact}` : ""}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: "#8a857c" }}>{cards.length} card{cards.length === 1 ? "" : "s"}</div>
        </header>

        {cards.length === 0 ? (
          <p style={{ textAlign: "center", color: "#8a857c" }}>This showcase is empty.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {cards.map((c) => {
              const photo = photoByCard.get(c.id);
              const price = showcase.show_prices ? money(c.manual_price ?? c.market_value) : null;
              const grade = c.condition_type === "graded" ? `${c.grader ?? ""} ${c.grade ?? ""}`.trim() : null;
              return (
                <div key={c.id} style={{ background: "#151517", border: "1px solid #26252a", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ aspectRatio: "5 / 7", background: "#0d0d0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={c.player ?? "card"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ color: "#3a3941", fontSize: 12 }}>no photo</span>
                    )}
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 }}>
                      {[c.year, c.player].filter(Boolean).join(" ") || "Card"}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#8a857c", marginTop: 1 }}>
                      {[c.set_name, c.parallel, c.card_number ? `#${c.card_number}` : null].filter(Boolean).join(" · ")}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginTop: 6 }}>
                      {grade && <span style={{ fontSize: 9, fontWeight: 700, color: "#c9a227", border: "1px solid rgba(201,162,39,0.4)", borderRadius: 4, padding: "1px 5px" }}>{grade}</span>}
                      {chips(c).map((t) => (
                        <span key={t} style={{ fontSize: 9, fontWeight: 700, color: "#c9a227", background: "rgba(201,162,39,0.12)", borderRadius: 4, padding: "1px 5px" }}>{t}</span>
                      ))}
                      {price && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#f5f1ea" }}>{price}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <footer style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: "#5a5850" }}>Powered by CardOps</footer>
      </div>
    </main>
  );
}
