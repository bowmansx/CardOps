import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { ReceiptsManager, type Receipt } from "@/components/cards/ReceiptsManager";

export const dynamic = "force-dynamic";

export default async function CardReceiptsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if ((await currentRole()) !== "owner") redirect("/cards");

  const [{ data: receipts }, { data: entities }] = await Promise.all([
    supabase.from("card_receipts")
      .select("id, entity_id, receipt_date, vendor, amount, note, disposition, treatment, to_entity_id, advance_disposition, advance_treatment, posted, created_at")
      .order("receipt_date", { ascending: false }).limit(500),
    supabase.from("card_businesses").select("id, short_code, name").eq("active", true).order("short_code"),
  ]);

  return (
    <ReceiptsManager
      initial={(receipts ?? []) as Receipt[]}
      entities={(entities ?? []) as { id: string; short_code: string; name: string }[]}
    />
  );
}
