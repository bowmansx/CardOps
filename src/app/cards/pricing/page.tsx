import Link from "next/link";
import { listPricingTemplates } from "./actions";
import { PricingBuilder } from "@/components/cards/PricingBuilder";

export const dynamic = "force-dynamic";

// Pricing standards studio (Beau, 2026-07-18): author the calculation formats
// that determine card values — compose blocks, lock what you know, let AI or
// the dice fill the rest, name it, save it. Saved formats appear in every
// strategy picker (intake modes, card form, value page) immediately.
export default async function PricingPage() {
  const templates = await listPricingTemplates();
  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pricing standards</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">
          Build the formats that determine card values: pick each block, 🔒 lock anything you&apos;re sure of,
          and let ✨ AI or the 🎲 dice fill in the rest — locked values never change while you re-roll.
        </p>
        <PricingBuilder templates={templates} />
      </div>
    </main>
  );
}
