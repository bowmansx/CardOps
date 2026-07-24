import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CARD_STATUSES } from "@/lib/cards/types";
import { BUILTIN_PROFILES } from "@/lib/cards/export";

export const dynamic = "force-dynamic";

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: dbProfiles } = await supabase
    .from("card_format_profiles")
    .select("name, direction")
    .in("direction", ["export", "both"])
    .eq("active", true)
    .order("name");
  const names = new Set((dbProfiles ?? []).map((p) => p.name as string));
  const profiles = [
    ...(dbProfiles ?? []).map((p) => ({ name: p.name as string })),
    // Built-ins (code-level, e.g. Whatnot) fill in when no DB row exists.
    ...Object.keys(BUILTIN_PROFILES).filter((n) => !names.has(n)).map((name) => ({ name })),
  ];
  const chosen = sp.profile || profiles?.[0]?.name || "generic_full";
  const qs = new URLSearchParams({ profile: chosen, ...(sp.status ? { status: sp.status } : {}) }).toString();

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Export</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">
          Download your inventory in any platform&apos;s format. Profiles are editable data — refine a
          template once and it sticks. (Verify each against the target platform&apos;s current spec.)
        </p>

        <form className="mt-5 space-y-3 rounded-xl border border-hairline bg-white p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Format</span>
            <select name="profile" defaultValue={chosen} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
              {(profiles ?? []).map((p) => <option key={p.name as string} value={p.name as string}>{p.name as string}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Status filter (optional)</span>
            <select name="status" defaultValue={sp.status ?? ""} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
              <option value="">All</option>
              {CARD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button className="w-full rounded-lg border border-hairline bg-white py-2 text-sm font-semibold">Update selection</button>
        </form>

        <a
          href={`/api/cards/export?${qs}`}
          className="mt-4 block rounded-xl bg-flag py-3 text-center font-bold text-white transition active:scale-95"
        >
          Download {chosen}.csv
        </a>
      </div>
    </main>
  );
}
