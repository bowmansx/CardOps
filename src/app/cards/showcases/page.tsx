import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { ShowcaseManager, type Showcase } from "@/components/cards/ShowcaseManager";

export const dynamic = "force-dynamic";

export default async function ShowcasesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasCardAccess(await currentRole())) redirect("/cards");

  const [{ data: showcases }, { data: groups }] = await Promise.all([
    supabase.from("card_showcases").select("id, token, title, card_ids, show_prices, for_sale, is_public, contact, created_at").order("created_at", { ascending: false }),
    supabase.from("card_groups").select("id, name").order("sort").order("name"),
  ]);

  return (
    <ShowcaseManager
      initial={(showcases ?? []) as Showcase[]}
      groups={(groups ?? []) as { id: string; name: string }[]}
    />
  );
}
