import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { cardOpsPrefs } from "@/lib/cards/settings";
import { CardOpsSettings } from "@/components/cards/CardOpsSettings";

export const dynamic = "force-dynamic";

// CardOps preferences (owner). Grading fees drive the Grade-or-Flip EV engine;
// description defaults drive the AI listing writer.
export default async function CardSettingsPage() {
  if ((await currentRole()) !== "owner") redirect("/cards");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("user_settings").select("prefs").eq("user_id", user!.id).maybeSingle();
  const prefs = cardOpsPrefs(data?.prefs as Record<string, unknown> | null);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-md px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CardOps settings</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <CardOpsSettings initial={prefs} />
      </div>
    </main>
  );
}
