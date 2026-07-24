import Link from "next/link";
import { LotsManager } from "@/components/cards/LotsManager";

export const dynamic = "force-dynamic";

// Lots — bundle multiple cards into one sale. Create from the Bulk page
// (select cards → Lot); manage/sell/reverse here.
export default function LotsPage() {
  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Lots</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3">
            <Link href="/cards/bulk" className="text-xs font-semibold text-flag underline-offset-4 hover:underline">+ New from Bulk</Link>
            <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] text-ink/45">
          Bundle cards into one sale. Selling a lot splits the proceeds across its cards by value, so each card&apos;s books and the pool basis stay correct.
        </p>
        <LotsManager />
      </div>
    </main>
  );
}
