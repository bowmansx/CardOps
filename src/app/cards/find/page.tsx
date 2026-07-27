import Link from "next/link";
import { FindCard } from "@/components/cards/FindCard";

export const dynamic = "force-dynamic";

// FIND — "which card in my inventory is this?" (Beau, 2026-07-26).
//
// A separate screen rather than a mode buried in intake, because the question
// is the opposite one: intake asks what a card IS and creates a row; this asks
// which row you already have and never creates anything.
export default function FindPage() {
  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Find a card</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-1 text-[11px] text-ink/45">
          Point the camera at a card you already own and go straight to its page — for when it&apos;s
          in your hand and its row is somewhere in a list too long to scroll.
        </p>

        <FindCard />
      </div>
    </main>
  );
}
