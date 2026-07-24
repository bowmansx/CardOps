import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { ConnectorMapping, type ConnectData } from "@/components/cards/ConnectorMapping";

export const dynamic = "force-dynamic";

// Connect one business to a bookkeeping app + map its accounts (Beau, 2026-07-24).
// Reads through the connectors API so the chart-of-accounts fetch lives in one place.
export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasCardAccess(await currentRole())) redirect("/cards");

  const { id } = await params;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const res = await fetch(`${proto}://${host}/api/cards/connectors?businessId=${id}`, {
    headers: { cookie: h.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) redirect("/cards/businesses");
  const data = (await res.json()) as ConnectData;

  return <ConnectorMapping data={data} />;
}
