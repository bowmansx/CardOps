import Link from "next/link";
import { notFound } from "next/navigation";
import { CardForm } from "@/components/cards/CardForm";
import { createClient } from "@/lib/supabase/server";
import type { Card } from "@/lib/cards/types";
import { updateCard, listStorageLocations } from "../../actions";
import { listStrategyOptions } from "../../pricing/actions";

export const dynamic = "force-dynamic";

export default async function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("cards").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Card;
  const [locations, strategies] = await Promise.all([listStorageLocations(), listStrategyOptions()]);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Edit card</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href={`/cards/${c.id}`} className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Card</Link>
        </header>
        <p className="figures mt-2 text-sm text-ink/50">{c.sku}</p>
        <CardForm action={updateCard.bind(null, c.id)} initial={c} submitLabel="Save changes" locations={locations} strategies={strategies.length ? strategies : undefined} />
      </div>
    </main>
  );
}
