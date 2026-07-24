"use server";

// Release a STUCK push claim (status pending/uncertain) so the entry becomes
// postable again. Recovery path for prevention rule 8 — a claim you can see
// but never clear is a dead end. Owner-only, and it can never touch a
// 'posted' row: releasing a posted claim would let the same entry post twice.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";

// A push batch finishes in seconds; a pending claim OLDER than this is stuck,
// a younger one may be a push still in flight — releasing that would let the
// same entry claim (and post) twice while the first request lands.
const STUCK_AFTER_MS = 10 * 60_000;

async function claimKey(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const reference = String(formData.get("reference") ?? "");
  if (!businessId || !provider || !reference) throw new Error("Missing claim key.");
  if ((await currentRole()) !== "owner") throw new Error("Owner only.");
  return { businessId, provider, reference, supabase: await createClient() };
}

export async function releaseClaim(formData: FormData): Promise<void> {
  const { businessId, provider, reference, supabase } = await claimKey(formData);
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await supabase
    .from("card_push_log")
    .delete()
    .eq("business_id", businessId)
    .eq("provider", provider)
    .eq("reference", reference)
    .in("status", ["pending", "uncertain"])
    .lt("pushed_at", cutoff)
    .select("reference");
  if (error) throw new Error(`Couldn't release the claim: ${error.message}`);
  if (!data?.length) {
    throw new Error("Nothing released — the claim is under 10 minutes old (a push may still be running) or already posted. Try again in a few minutes.");
  }
  revalidatePath("/cards/books/push-preview");
}

// The other half of the stuck-claim decision: the journal DOES exist in the
// books → record it as posted so the preview and the idempotency guard agree
// with reality. Never touches rows already posted.
export async function markClaimPosted(formData: FormData): Promise<void> {
  const { businessId, provider, reference, supabase } = await claimKey(formData);
  const { data, error } = await supabase
    .from("card_push_log")
    .update({ status: "posted", error: null, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("provider", provider)
    .eq("reference", reference)
    .in("status", ["pending", "uncertain"])
    .select("reference");
  if (error) throw new Error(`Couldn't mark the claim posted: ${error.message}`);
  if (!data?.length) throw new Error("Nothing updated — the claim is gone or already posted.");
  revalidatePath("/cards/books/push-preview");
}
