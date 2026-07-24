import Link from "next/link";
import { CardForm } from "@/components/cards/CardForm";
import { createCard, listStorageLocations } from "../actions";
import { listStrategyOptions } from "../pricing/actions";

export const dynamic = "force-dynamic";

export default async function NewCardPage() {
  const [locations, strategies] = await Promise.all([listStorageLocations(), listStrategyOptions()]);
  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Add card</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">
            ← Cards
          </Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">A SKU is assigned automatically on save.</p>
        <CardForm action={createCard} submitLabel="Save card" locations={locations} strategies={strategies.length ? strategies : undefined} />
      </div>
    </main>
  );
}
