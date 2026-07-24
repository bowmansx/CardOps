import { createClient } from "@/lib/supabase/server";

// Server-only role resolution. RLS is the real boundary; these gate the UI.
export type Role = "owner" | "card_ops" | null;

export async function currentRole(): Promise<Role> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return ((data?.role as Role) ?? null);
}

export function hasCardAccess(role: Role): boolean {
  return role === "owner" || role === "card_ops";
}
