"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Disconnect eBay: delete the (encrypted) token row. RLS owner-only.
export async function disconnectEbay() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { error } = await supabase.from("ebay_connections").delete().eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/cards/services");
}

// Owner-only (RLS on service_config enforces it) toggle of a paid service.
export async function toggleService(key: string, enabled: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { error } = await supabase.from("service_config").update({ enabled }).eq("key", key);
  if (error) throw new Error(error.message);
  revalidatePath("/cards/services");
}
