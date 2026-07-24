"use server";

// Release a STUCK push claim (status pending/uncertain) so the entry becomes
// postable again. Recovery path for prevention rule 8 — a claim you can see
// but never clear is a dead end. Owner-only, and it can never touch a
// 'posted' row: releasing a posted claim would let the same entry post twice.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";

export async function releaseClaim(formData: FormData): Promise<void> {
  const businessId = String(formData.get("businessId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const reference = String(formData.get("reference") ?? "");
  if (!businessId || !provider || !reference) throw new Error("Missing claim key.");
  if ((await currentRole()) !== "owner") throw new Error("Owner only.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("card_push_log")
    .delete()
    .eq("business_id", businessId)
    .eq("provider", provider)
    .eq("reference", reference)
    .in("status", ["pending", "uncertain"]);
  if (error) throw new Error(`Couldn't release the claim: ${error.message}`);
  revalidatePath("/cards/books/push-preview");
}
