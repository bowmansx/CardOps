import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { MoversView } from "@/components/cards/MoversView";

export const dynamic = "force-dynamic";

export default async function MoversPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasCardAccess(await currentRole())) redirect("/cards");
  return <MoversView />;
}
