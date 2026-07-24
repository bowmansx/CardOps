import Link from "next/link";
import { FullIntake } from "@/components/cards/FullIntake";
import { SpeedBook } from "@/components/cards/SpeedBook";
import { BatchIntake } from "@/components/cards/BatchIntake";
import { listStorageNames, listEntityOptions } from "./actions";
import { listStrategyOptions } from "../pricing/actions";

export const dynamic = "force-dynamic";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const [locations, strategies, entities] = await Promise.all([listStorageNames(), listStrategyOptions(), listEntityOptions()]);
  const speed = mode === "speed";
  const batch = mode === "batch";
  const full = !speed && !batch;
  const tab = "rounded-full border px-4 py-1.5 text-sm font-semibold transition";
  const on = "border-flag bg-flag text-white";
  const off = "border-hairline bg-white text-ink/60";

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Intake</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>

        <div className="mt-3 flex gap-2">
          <Link href="/cards/intake" className={`${tab} ${full ? on : off}`}>Full (AI)</Link>
          <Link href="/cards/intake?mode=batch" className={`${tab} ${batch ? on : off}`}>Batch (AI)</Link>
          <Link href="/cards/intake?mode=speed" className={`${tab} ${speed ? on : off}`}>Speed Book</Link>
        </div>
        <p className="mt-2 text-sm text-ink/60">
          {speed
            ? "Front-only rapid capture — no AI calls. Book a lot at a shared pool cost."
            : batch
              ? "Set defaults once, rapid-scan the stack, book — then AI reads every card in the background into one review pile."
              : "Photograph front (+ back), let AI fill it in, review, and book. Falls back to manual if AI is off."}
        </p>

        {speed ? (
          <SpeedBook strategies={strategies.length ? strategies : undefined} entities={entities} />
        ) : batch ? (
          <BatchIntake locations={locations} strategies={strategies.length ? strategies : undefined} entities={entities} />
        ) : (
          <FullIntake strategies={strategies.length ? strategies : undefined} entities={entities} />
        )}
      </div>
    </main>
  );
}
