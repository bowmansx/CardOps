import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentRole } from "@/lib/cards/roles";
import { createClient } from "@/lib/supabase/server";
import { ebayConfigured } from "@/lib/ebay/oauth";
import { toggleService, disconnectEbay } from "./actions";

export const dynamic = "force-dynamic";

const MASTEROPS_ORIGIN = "https://master-ops-iota.vercel.app";

type Svc = { key: string; enabled: boolean; mode: string | null; monthly_cost_est: number | null; notes: string | null };

const LABELS: Record<string, string> = {
  anthropic_vision: "AI card scan (Anthropic)",
  pricecharting: "PriceCharting comps",
  ximilar: "Ximilar 2nd-opinion ID",
  ebay_api: "eBay listing API",
  stripe: "Stripe checkout (/shop)",
  news_feed: "News flag feed",
  storage_r2: "Cloudflare R2 photo storage",
};

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ ebay?: string; msg?: string }>;
}) {
  const role = await currentRole();
  if (role !== "owner") redirect("/cards");
  const sp = await searchParams;

  const supabase = await createClient();
  const [{ data }, { data: ebayConn }] = await Promise.all([
    supabase.from("service_config").select("*").order("key"),
    supabase.from("ebay_connections").select("updated_at, ebay_user").maybeSingle(),
  ]);
  const rows = (data ?? []) as Svc[];
  const monthly = rows.filter((r) => r.enabled).reduce((s, r) => s + Number(r.monthly_cost_est ?? 0), 0);

  // OAuth routes are single-homed on the MasterOps domain (registered RuName);
  // from the standalone app the Connect link crosses over top-level.
  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host") ?? "";
  const onMasterOps = !host.startsWith("card-ops");
  // The cardops Vercel project doesn't carry the eBay env — let the MasterOps
  // connect route be the judge when we're on the standalone domain.
  const ebayReady = onMasterOps ? ebayConfigured() : true;

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Services</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">
          Every paid integration is off by default — CardOps runs at $0/mo. Turn on only what you need.
          Est. monthly with current toggles: <b className="figures">${monthly.toFixed(2)}</b>.
        </p>

        {/* eBay connection (Phase 1) */}
        {sp.ebay === "connected" && (
          <p className="mt-3 rounded-xl border border-pos/30 bg-pos/10 px-3 py-2 text-sm text-pos">eBay connected ✓</p>
        )}
        {sp.ebay === "error" && (
          <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">eBay connect failed: {sp.msg ?? "unknown error"}</p>
        )}
        {sp.ebay === "not-configured" && (
          <p className="mt-3 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">eBay keys aren&apos;t in Vercel env yet — add them, redeploy, then Connect.</p>
        )}
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">eBay seller account</div>
            <div className="figures text-[11px] text-ink/50">
              {ebayConn
                ? `Connected · ${new Date(ebayConn.updated_at as string).toLocaleDateString()}`
                : ebayReady
                  ? "Keys in place — ready to connect"
                  : "Awaiting keys (EBAY_CLIENT_ID / SECRET / RUNAME / TOKEN_KEY in Vercel env)"}
            </div>
          </div>
          {ebayConn ? (
            onMasterOps ? (
              <form action={disconnectEbay}>
                <button className="rounded-full border border-danger/40 px-3 py-1 text-xs font-semibold text-danger">Disconnect</button>
              </form>
            ) : (
              <span className="figures text-[10px] text-ink/40">manage on MasterOps</span>
            )
          ) : (
            <a
              href={`${MASTEROPS_ORIGIN}/api/ebay/connect`}
              className={"rounded-full px-3 py-1 text-xs font-bold " + (ebayReady ? "bg-flag text-white" : "border border-hairline text-ink/40 pointer-events-none")}
            >
              Connect eBay
            </a>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{LABELS[r.key] ?? r.key}</div>
                <div className="figures text-[11px] text-ink/50">{r.key}{r.monthly_cost_est ? ` · ~$${Number(r.monthly_cost_est).toFixed(0)}/mo` : ""}</div>
              </div>
              <form action={toggleService.bind(null, r.key, !r.enabled)}>
                <button
                  className={
                    "rounded-full px-3 py-1 text-xs font-bold transition " +
                    (r.enabled ? "bg-pos text-white" : "border border-hairline bg-white text-ink/50")
                  }
                >
                  {r.enabled ? "ON" : "off"}
                </button>
              </form>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink/40">
          With AI card scan off, Full Intake still works — it just falls back to a manual form (photos still saved).
        </p>
      </div>
    </main>
  );
}
