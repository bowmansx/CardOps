import Link from "next/link";
import { redirect } from "next/navigation";
import { currentRole } from "@/lib/cards/roles";
import { ebayConfigured } from "@/lib/ebay/oauth";
import { EbayHub } from "@/components/cards/EbayHub";

export const dynamic = "force-dynamic";

// eBay Hub — Beau's seller command center. Owner-only. On the CardOps
// deployment (eBay env is single-homed on MasterOps) this renders a
// link-over card instead.
export default async function EbayHubPage() {
  if ((await currentRole()) !== "owner") redirect("/cards");

  if (!ebayConfigured()) {
    return (
      <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5">
          <h1 className="text-2xl font-bold tracking-tight">eBay Hub</h1>
          <div className="mt-1 h-[3px] w-14 bg-flag" />
          <div className="mt-6 rounded-xl border border-hairline bg-white p-4 text-sm text-ink/70">
            eBay controls live on MasterOps.
            <a
              href="https://master-ops-iota.vercel.app/cards/ebay"
              className="mt-3 block w-fit rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white"
            >
              Open eBay Hub →
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">eBay Hub</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3">
            <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">Cards</Link>
            <Link href="/cards/sales" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">Sales</Link>
            <Link href="/cards/services" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">Services</Link>
          </span>
        </header>
        <EbayHub />
      </div>
    </main>
  );
}
