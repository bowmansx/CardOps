import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { buildLabelZpl } from "@/lib/cards/zpl";
import { LabelActions } from "@/components/cards/LabelActions";

export const dynamic = "force-dynamic";

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("cards")
    .select("id, sku, player, year, set_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/cards/${data.id}`;
  const qr = await QRCode.toDataURL(url, { margin: 0, width: 300, errorCorrectionLevel: "M" });
  const title = [data.year, data.player, data.set_name].filter(Boolean).join(" ") || (data.sku as string);
  const zpl = buildLabelZpl({ url, sku: data.sku as string, title });

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @page { size: 1.5in 1in; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          .label { position: fixed; left: 0; top: 0; border: 0 !important; }
        }
      `,
        }}
      />
      <main className="min-h-dvh bg-paper text-ink" style={{ colorScheme: "dark" }}>
        <div className="no-print mx-auto max-w-md px-4 pb-8">
          <header className="flex items-baseline justify-between pt-5 pb-1">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Label</h1>
              <div className="mt-1 h-[3px] w-14 bg-flag" />
            </div>
            <Link href={`/cards/${data.id}`} className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Card</Link>
          </header>
          <p className="mt-2 text-sm text-ink/60">
            Sized for your ZD411 (1.5&quot;×1&quot;). <b>Print label</b> uses the browser →
            set the printer to the ZD411 and the 1.5×1 label media. For the crispest thermal
            output, <b>Copy ZPL</b> and send it via Zebra Browser Print.
          </p>
          <div className="mt-4">
            <LabelActions zpl={zpl} />
          </div>
          <p className="figures mt-4 text-[11px] uppercase tracking-wider text-ink/40">Preview</p>
        </div>

        {/* The physical label — exact 1.5in x 1in. */}
        <div
          className="label mx-auto flex items-center gap-2 border border-hairline bg-white"
          style={{ width: "1.5in", height: "1in", padding: "0.06in", boxSizing: "border-box" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR" style={{ width: "0.86in", height: "0.86in", flexShrink: 0 }} />
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div className="figures" style={{ fontSize: "10pt", fontWeight: 700, lineHeight: 1.05, wordBreak: "break-all" }}>
              {data.sku as string}
            </div>
            <div style={{ fontSize: "7pt", lineHeight: 1.1, marginTop: "2px" }}>{title}</div>
          </div>
        </div>
      </main>
    </>
  );
}
