"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole } from "@/lib/cards/roles";

// Owner-only test grant, for dialing the credit system in before billing
// exists. Goes through credit_grant (the only legal way credits appear) so
// the FIFO/expiry machinery is exercised exactly as a real purchase would.
export async function grantTestCredits(formData: FormData) {
  if ((await currentRole()) !== "owner") throw new Error("Owner only.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const amount = Math.floor(Number(formData.get("amount")));
  if (!Number.isFinite(amount) || amount < 1 || amount > 100_000) {
    throw new Error("Amount must be 1–100,000 credits.");
  }
  const days = Math.floor(Number(formData.get("expires_days") || 0));
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

  const svc = createServiceClient();
  if (!svc) throw new Error("Service key not configured.");
  const { error } = await svc.rpc("credit_grant", {
    p_user: user.id,
    p_amount: amount,
    p_kind: expiresAt ? "plan_grant" : "purchase",
    p_expires_at: expiresAt,
    p_reason: "test grant (credits page)",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/cards/credits");
}

// Flip enforcement (shadow mode ↔ hard gate). Owner-only; the RLS on
// service_config enforces it a second time at the row.
export async function setEnforcement(enabled: boolean) {
  if ((await currentRole()) !== "owner") throw new Error("Owner only.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_config").update({ enabled }).eq("key", "credit_enforcement");
  if (error) throw new Error(error.message);
  revalidatePath("/cards/credits");
}
