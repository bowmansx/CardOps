import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { BusinessesManager, type Business } from "@/components/cards/BusinessesManager";
import { AutoEstimateSettings, type CardPrefs } from "@/components/cards/AutoEstimateSettings";

export const dynamic = "force-dynamic";

// CardOps businesses (Beau, 2026-07-24). Every card user manages their OWN
// businesses — this is what lets CardOps stand alone without MasterOps' entities.
// Card-access (not owner-only): RLS scopes rows to the caller.
export default async function BusinessesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasCardAccess(await currentRole())) redirect("/cards");

  const [{ data }, { data: prefs }] = await Promise.all([
    supabase.from("card_businesses")
      .select("id, name, short_code, type, zoho_books_org_id, connector, active")
      .order("short_code"),
    supabase.from("card_user_prefs").select("auto_estimate, estimate_model").maybeSingle(),
  ]);

  return (
    <BusinessesManager
      initial={(data ?? []) as Business[]}
      settings={<AutoEstimateSettings initial={(prefs ?? { auto_estimate: "both", estimate_model: "light" }) as CardPrefs} />}
    />
  );
}
