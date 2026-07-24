"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ShoppingCart, Loader2, ExternalLink, RefreshCw, Gavel, Tag as TagIcon,
  Truck, HandCoins, Archive, Pencil, Megaphone, Check, X, Star, MessageSquare, Send,
} from "lucide-react";

// The seller command center: everything Beau would do in eBay Seller Hub,
// from inside CardOps. One /api/ebay/hub fetch feeds all tabs; every action
// hits its own route and refreshes. All fetches are JSON-guarded (serverless
// timeouts return plain text) and eBay errors show verbatim per row.

type Listing = {
  itemId: string; title: string; sku: string | null;
  price: number | null; binPrice: number | null;
  format: "auction" | "fixed"; timeLeft: string | null;
  watchers: number | null; bids: number | null;
  photo: string | null; bestOfferEnabled: boolean;
  cardId: string | null; cardTitle: string | null; canSendOffer: boolean;
};
type Order = {
  orderId: string; createdAt: string; paymentStatus: string; fulfillmentStatus: string;
  cancelState?: string;
  buyer: string | null; total: number; subtotal: number; deliveryCost: number;
  marketplaceFee: number | null;
  shipTo: { name: string | null; city: string | null; state: string | null; zip: string | null };
  lineItems: { lineItemId: string; legacyItemId?: string | null; title: string; total: number }[];
  settled?: boolean; cardId?: string | null;
};
type BuyerOffer = {
  offerId: string; buyer: string | null; price: number | null;
  status: string | null; message: string | null; expires: string | null;
};
type Hub = {
  active: Listing[]; unsold: Listing[];
  awaitingShipment: Order[]; recentOrders: Order[];
  stats: {
    activeCount: number; activeValue: number; watchers: number; bids: number;
    awaitingCount: number; sold30Count: number; sold30Total: number; profit30: number;
    unsettled: number;
  };
  errors?: Record<string, string>;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  try { return JSON.parse(text); } catch {
    throw new Error(`Request failed (HTTP ${r.status}) — likely a timeout; try again.`);
  }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await readJson(r);
  if (!r.ok) throw new Error((d.error as string) || "Request failed.");
  return d;
}

const TABS = [
  { key: "active", label: "Active", icon: TagIcon },
  { key: "ship", label: "Ship", icon: Truck },
  { key: "offers", label: "Offers", icon: HandCoins },
  { key: "sold", label: "Sold", icon: ShoppingCart },
  { key: "ended", label: "Ended", icon: Archive },
  { key: "messages", label: "Inbox", icon: MessageSquare },
  { key: "feedback", label: "Reviews", icon: Star },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type FeedbackComment = {
  feedbackId: string; user: string | null; type: string | null; text: string | null;
  time: string | null; itemId: string | null; role: string | null; responded: boolean;
};
type FeedbackData = { score: number | null; positivePct: number | null; comments: FeedbackComment[] };
type Msg = {
  messageId: string; sender: string | null; subject: string | null; body: string | null;
  itemId: string | null; date: string | null; responded: boolean;
};

export function EbayHub() {
  const [hub, setHub] = useState<Hub | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("active");
  // Set of in-flight action keys — NOT a single value, so one action
  // finishing can't re-enable buttons for another still running (which could
  // fire a duplicate irreversible eBay call).
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const loadSeq = useRef(0);
  // Bumped by a full refresh so the lazy tabs re-fetch even while one is open
  // (resetting a ref alone won't re-fire an effect).
  const [refreshTick, setRefreshTick] = useState(0);

  // per-listing pending buyer offers (Offers tab)
  const [offers, setOffers] = useState<Record<string, BuyerOffer[]> | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);
  const offersLoaded = useRef(false);

  // Feedback + Messages tabs — lazy-loaded on first open (extra Trading calls).
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const feedbackLoaded = useRef(false);
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const messagesLoaded = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setHub(null); setLoadErr(null);
      // A full refresh re-arms the lazy tabs so they aren't stuck on stale data,
      // and bumps the tick so the OPEN tab re-fetches immediately.
      offersLoaded.current = false;
      feedbackLoaded.current = false;
      messagesLoaded.current = false;
      setRefreshTick((t) => t + 1);
    }
    const seq = ++loadSeq.current;
    try {
      const r = await fetch("/api/ebay/hub");
      const d = await readJson(r);
      if (seq !== loadSeq.current) return; // a newer load already won
      if (!r.ok) throw new Error((d.error as string) || "Couldn't load the hub.");
      setHub(d as unknown as Hub);
    } catch (e) {
      if (seq === loadSeq.current) setLoadErr(e instanceof Error ? e.message : "Couldn't load the hub.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadOffers = useCallback(async (items: Listing[]) => {
    setOffersLoading(true);
    try {
      const ids = items.filter((l) => l.format === "fixed").map((l) => l.itemId);
      const d = await post("/api/ebay/offers", { op: "list_all", itemIds: ids });
      setOffers((d.byItem as Record<string, BuyerOffer[]>) ?? {});
    } catch (e) {
      setRowErr((p) => ({ ...p, offers_tab: e instanceof Error ? e.message : "Couldn't load offers." }));
    } finally {
      setOffersLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab === "offers" && hub && !offersLoaded.current) {
      offersLoaded.current = true;
      void loadOffers(hub.active);
    }
  }, [tab, hub, loadOffers, refreshTick]);

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const r = await fetch("/api/ebay/feedback");
      const d = await readJson(r);
      if (!r.ok) throw new Error((d.error as string) || "Couldn't load feedback.");
      setFeedback(d as unknown as FeedbackData);
    } catch (e) {
      setRowErr((p) => ({ ...p, feedback_tab: e instanceof Error ? e.message : "Couldn't load feedback." }));
    } finally {
      setFeedbackLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab === "feedback" && !feedbackLoaded.current) {
      feedbackLoaded.current = true;
      void loadFeedback();
    }
  }, [tab, loadFeedback, refreshTick]);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const r = await fetch("/api/ebay/messages");
      const d = await readJson(r);
      if (!r.ok) throw new Error((d.error as string) || "Couldn't load messages.");
      setMessages((d.messages as Msg[]) ?? []);
    } catch (e) {
      setRowErr((p) => ({ ...p, messages_tab: e instanceof Error ? e.message : "Couldn't load messages." }));
    } finally {
      setMessagesLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab === "messages" && !messagesLoaded.current) {
      messagesLoaded.current = true;
      void loadMessages();
    }
  }, [tab, loadMessages, refreshTick]);

  async function act(key: string, fn: () => Promise<void>, doneNote?: string) {
    // Ignore a repeat click on an action already running.
    let already = false;
    setBusyKeys((p) => { if (p.has(key)) { already = true; return p; } const n = new Set(p); n.add(key); return n; });
    if (already) return;
    setRowErr((p) => { const n = { ...p }; delete n[key]; return n; });
    try {
      await fn();
      if (doneNote) { setNotice(doneNote); setTimeout(() => setNotice(null), 4000); }
      await load(true);
    } catch (e) {
      setRowErr((p) => ({ ...p, [key]: e instanceof Error ? e.message : "Failed." }));
    } finally {
      setBusyKeys((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  }

  if (loadErr) {
    return (
      <div className="mt-6 rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm text-danger">{loadErr}</p>
        <button onClick={() => void load()} className="mt-2 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-semibold">
          Retry
        </button>
      </div>
    );
  }
  if (!hub) {
    return (
      <div className="mt-10 flex items-center justify-center gap-2 text-sm text-ink/50">
        <Loader2 size={16} className="animate-spin" /> Pulling your eBay world…
      </div>
    );
  }

  const s = hub.stats;
  const badge = (t: TabKey) =>
    t === "ship" ? s.awaitingCount : t === "sold" ? s.unsettled : t === "ended" ? hub.unsold.length : 0;

  return (
    <div className="mt-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile big={String(s.activeCount)} small={`Active · ${money(s.activeValue)}`} />
        <Tile big={`${s.watchers}${s.bids ? ` · ${s.bids} bids` : ""}`} small="Watchers" />
        <Tile big={String(s.awaitingCount)} small="To ship" tone={s.awaitingCount > 0 ? "warn" : undefined} />
        <Tile big={money(s.sold30Total)} small={`Sold 30d · P/L ${money(s.profit30)}`} tone={s.profit30 >= 0 ? "pos" : "neg"} />
      </div>

      {hub.errors && (
        <div className="mt-2 space-y-1">
          {Object.entries(hub.errors).map(([k, v]) => (
            <p key={k} className="text-[11px] leading-snug text-warn/90">
              <span className="font-bold uppercase">{k}:</span> {v}
            </p>
          ))}
        </div>
      )}
      {notice && (
        <p className="mt-2 rounded-lg border border-pos/30 bg-pos/5 px-3 py-1.5 text-xs font-semibold text-pos">{notice}</p>
      )}

      {/* Tabs */}
      <div className="mt-4 flex overflow-hidden rounded-xl border border-hairline text-xs font-semibold">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={"flex flex-1 items-center justify-center gap-1.5 px-2 py-2 " + (tab === t.key ? "bg-flag text-white" : "bg-white text-ink/50")}>
            <t.icon size={13} /> {t.label}
            {badge(t.key) > 0 && (
              <span className={"figures rounded-full px-1.5 text-[10px] font-bold " + (tab === t.key ? "bg-white/25" : "bg-flag/15 text-flag")}>
                {badge(t.key)}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "active" && (
        <ListingList
          items={hub.active} kind="active" busyKeys={busyKeys} rowErr={rowErr}
          onRevise={(l, price) => act(`rev:${l.itemId}`, async () => { await post("/api/ebay/revise", { cardId: l.cardId, price }); }, "Price updated on eBay.")}
          onEnd={(l) => act(`end:${l.itemId}`, async () => { await post("/api/ebay/end", { cardId: l.cardId }); }, "Listing ended.")}
          onSendOffer={(l, price) => act(`ofr:${l.itemId}`, async () => { await post("/api/ebay/send-offer", { cardId: l.cardId, price }); }, "Offer sent to interested buyers.")}
          onRelist={() => {}}
        />
      )}

      {tab === "ship" && (
        <ShipList orders={hub.awaitingShipment} busyKeys={busyKeys} rowErr={rowErr}
          onShip={(o, carrier, tracking) =>
            act(`ship:${o.orderId}`, async () => { await post("/api/ebay/ship", { orderId: o.orderId, carrier, tracking }); }, "Marked shipped — buyer notified.")}
          onCancel={(o, reason) =>
            act(`cancel:${o.orderId}`, async () => {
              const d = await post("/api/ebay/cancel-order", { orderId: o.orderId, reason });
              // 200 can still carry a warning (refund done, book reversal failed).
              if (d.warning) throw new Error(d.warning as string);
            }, "Order cancelled — buyer refunded. Any settled sale was reversed.")} />
      )}

      {tab === "offers" && (
        <OffersTab
          hub={hub} offers={offers} loading={offersLoading} rowErr={rowErr} busyKeys={busyKeys}
          onReload={() => { offersLoaded.current = true; void loadOffers(hub.active); }}
          onRespond={(itemId, o, action, counterPrice) =>
            act(`bo:${o.offerId}`, async () => {
              await post("/api/ebay/offers", { op: "respond", itemId, offerId: o.offerId, action, counterPrice });
              setOffers((p) => {
                if (!p) return p;
                const n = { ...p, [itemId]: (p[itemId] ?? []).filter((x) => x.offerId !== o.offerId) };
                if (!n[itemId].length) delete n[itemId];
                return n;
              });
            }, action === "accept" ? "Offer accepted — it'll appear in Sold after eBay processes payment." : action === "counter" ? "Counter sent." : "Offer declined.")} />
      )}

      {tab === "sold" && (
        <SoldTab orders={hub.recentOrders} busyKeys={busyKeys} rowErr={rowErr}
          onSync={() => act("sync", async () => {
            const d = await post("/api/ebay/sync", {});
            const settled = (d.settled as unknown[] | undefined)?.length ?? 0;
            const failures = (d.failures as unknown[] | undefined)?.length ?? 0;
            const parts = [
              settled ? `${settled} sale${settled === 1 ? "" : "s"} settled into your books` : "everything already settled",
              failures ? `${failures} failed — check the row errors` : "",
            ].filter(Boolean);
            if (failures) throw new Error(`Synced with problems: ${parts.join("; ")}.`);
            setNotice(`Synced — ${parts.join("; ")}.`);
            setTimeout(() => setNotice(null), 5000);
          })} />
      )}

      {tab === "ended" && (
        <ListingList
          items={hub.unsold} kind="ended" busyKeys={busyKeys} rowErr={rowErr}
          onRevise={() => {}} onEnd={() => {}} onSendOffer={() => {}}
          onRelist={(l) => act(`rel:${l.itemId}`, async () => { await post("/api/ebay/relist", { cardId: l.cardId }); }, "Relisted on eBay.")}
        />
      )}

      {tab === "messages" && (
        <MessagesTab
          messages={messages} loading={messagesLoading} rowErr={rowErr} busyKeys={busyKeys}
          onReload={() => { messagesLoaded.current = true; void loadMessages(); }}
          onReply={(m, text) => act(`msg:${m.messageId}`, async () => {
            await post("/api/ebay/messages", { op: "reply", itemId: m.itemId, parentMessageId: m.messageId, recipientId: m.sender, body: text });
            setMessages((p) => (p ?? []).map((x) => x.messageId === m.messageId ? { ...x, responded: true } : x));
          }, "Reply sent.")} />
      )}

      {tab === "feedback" && (
        <FeedbackTab
          feedback={feedback} loading={feedbackLoading} rowErr={rowErr} busyKeys={busyKeys}
          orders={hub.recentOrders}
          onReload={() => { feedbackLoaded.current = true; void loadFeedback(); }}
          onReply={(c, text) => act(`fb:${c.feedbackId}`, async () => {
            await post("/api/ebay/feedback", { op: "reply", feedbackId: c.feedbackId, targetUser: c.user, text });
            setFeedback((p) => p ? { ...p, comments: p.comments.map((x) => x.feedbackId === c.feedbackId ? { ...x, responded: true } : x) } : p);
          }, "Reply posted.")}
          onLeave={(o, text) => act(`leave:${o.orderId}`, async () => {
            await post("/api/ebay/feedback", { op: "leave", itemId: o.lineItems[0]?.legacyItemId, targetUser: o.buyer, text });
          }, "Feedback left for the buyer.")} />
      )}

      <button onClick={() => void load()} className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-ink/40 hover:text-ink">
        <RefreshCw size={12} /> Refresh everything
      </button>
    </div>
  );
}

function Tile({ big, small, tone }: { big: string; small: string; tone?: "pos" | "neg" | "warn" }) {
  const toneCls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-xl border border-hairline bg-white px-3 py-2.5">
      <div className={"figures truncate text-lg font-bold " + toneCls}>{big}</div>
      <div className="truncate text-[10px] uppercase tracking-wider text-ink/50">{small}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-xl border border-hairline bg-white">
      <p className="figures px-4 py-10 text-center text-sm text-ink/40">{text}</p>
    </div>
  );
}

function RowShell({ children, err }: { children: React.ReactNode; err?: string }) {
  return (
    <div className="border-b border-hairline px-3 py-2.5 last:border-b-0">
      {children}
      {err && <p className="mt-1.5 text-[11px] leading-snug text-danger">{err}</p>}
    </div>
  );
}

// ── Active / Ended listings ──────────────────────────────────────────────────
function ListingList({
  items, kind, busyKeys, rowErr, onRevise, onEnd, onSendOffer, onRelist,
}: {
  items: Listing[]; kind: "active" | "ended"; busyKeys: Set<string>; rowErr: Record<string, string>;
  onRevise: (l: Listing, price: number) => void;
  onEnd: (l: Listing) => void;
  onSendOffer: (l: Listing, price: number) => void;
  onRelist: (l: Listing) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [offering, setOffering] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);

  if (!items.length) {
    return <Empty text={kind === "active" ? "Nothing live on eBay right now — list a card from its page." : "No ended listings in the last 30 days."} />;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-white">
      {items.map((l) => {
        const busy = [...busyKeys].some((k) => k.endsWith(`:${l.itemId}`));
        const err = rowErr[`rev:${l.itemId}`] ?? rowErr[`end:${l.itemId}`] ?? rowErr[`ofr:${l.itemId}`] ?? rowErr[`rel:${l.itemId}`];
        return (
          <RowShell key={l.itemId} err={err}>
            <div className="flex items-center gap-3">
              {l.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.photo} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-hairline object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink/25">
                  {l.format === "auction" ? <Gavel size={16} /> : <TagIcon size={16} />}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{l.title}</div>
                <div className="figures mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink/50">
                  {l.format === "auction" ? (
                    <span className="flex items-center gap-1 font-bold text-flag"><Gavel size={11} /> {l.bids ?? 0} bids{l.timeLeft ? ` · ${l.timeLeft} left` : ""}</span>
                  ) : (
                    <span>Buy It Now{l.bestOfferEnabled ? " · offers on" : ""}</span>
                  )}
                  {l.watchers != null && l.watchers > 0 && <span>{l.watchers} watching</span>}
                  {l.sku && <span>{l.sku}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="figures block text-sm font-bold">{money(l.price)}</span>
                {l.format === "auction" && l.binPrice != null && (
                  <span className="figures block text-[10px] text-ink/40">BIN {money(l.binPrice)}</span>
                )}
              </div>
            </div>

            {/* Action strip */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-14">
              {kind === "active" && (
                <>
                  {editing === l.itemId ? (
                    <span className="flex items-center gap-1">
                      <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} type="number" step="0.01" min="0.01" autoFocus
                        className="figures w-24 rounded-lg border border-hairline bg-white px-2 py-1 text-xs outline-none focus:border-flag" />
                      <MiniBtn disabled={busy || !(Number(editPrice) > 0)} onClick={() => { setEditing(null); onRevise(l, Number(editPrice)); }}>
                        <Check size={12} />
                      </MiniBtn>
                      <MiniBtn onClick={() => setEditing(null)}><X size={12} /></MiniBtn>
                    </span>
                  ) : (
                    <MiniBtn disabled={busy || !l.cardId} onClick={() => { setEditing(l.itemId); setEditPrice(l.price != null ? String(l.price) : ""); }}>
                      <Pencil size={11} /> Price
                    </MiniBtn>
                  )}
                  {l.canSendOffer && l.cardId && (
                    offering === l.itemId ? (
                      <span className="flex items-center gap-1 text-[11px] text-ink/50">
                        {[5, 10, 15].map((pct) => (
                          <MiniBtn key={pct} disabled={busy || l.price == null}
                            onClick={() => { setOffering(null); onSendOffer(l, Math.max(0.99, Math.round((l.price! * (1 - pct / 100)) * 100) / 100)); }}>
                            −{pct}%
                          </MiniBtn>
                        ))}
                        <MiniBtn onClick={() => setOffering(null)}><X size={12} /></MiniBtn>
                      </span>
                    ) : (
                      <MiniBtn disabled={busy} onClick={() => setOffering(l.itemId)}>
                        <Megaphone size={11} /> Offer watchers
                      </MiniBtn>
                    )
                  )}
                  {confirmEnd === l.itemId ? (
                    <span className="flex items-center gap-1">
                      <MiniBtn tone="danger" disabled={busy || !l.cardId} onClick={() => { setConfirmEnd(null); onEnd(l); }}>End it</MiniBtn>
                      <MiniBtn onClick={() => setConfirmEnd(null)}><X size={12} /></MiniBtn>
                    </span>
                  ) : (
                    <MiniBtn disabled={busy || !l.cardId} onClick={() => setConfirmEnd(l.itemId)}>End</MiniBtn>
                  )}
                </>
              )}
              {kind === "ended" && (
                <MiniBtn disabled={busy || !l.cardId} onClick={() => onRelist(l)}>
                  <RefreshCw size={11} /> Relist
                </MiniBtn>
              )}
              {busy && <Loader2 size={12} className="animate-spin text-flag" />}
              <a href={`https://www.ebay.com/itm/${l.itemId}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-semibold text-flag underline-offset-2 hover:underline">
                eBay <ExternalLink size={10} />
              </a>
              {l.cardId && (
                <Link href={`/cards/${l.cardId}`} className="text-[11px] font-semibold text-ink/40 underline-offset-2 hover:text-ink hover:underline">
                  Card →
                </Link>
              )}
              {!l.cardId && <span className="text-[10px] text-ink/30">not a CardOps card</span>}
            </div>
          </RowShell>
        );
      })}
    </div>
  );
}

function MiniBtn({ children, onClick, disabled, tone }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: "danger";
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={"flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold disabled:opacity-40 " +
        (tone === "danger" ? "border-danger/40 bg-danger/5 text-danger" : "border-hairline bg-white text-ink/70")}>
      {children}
    </button>
  );
}

// ── Awaiting shipment ────────────────────────────────────────────────────────
function ShipList({ orders, busyKeys, rowErr, onShip, onCancel }: {
  orders: Order[]; busyKeys: Set<string>; rowErr: Record<string, string>;
  onShip: (o: Order, carrier: string, tracking: string) => void;
  onCancel: (o: Order, reason: string) => void;
}) {
  const [carrier, setCarrier] = useState<Record<string, string>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState<string | null>(null);
  if (!orders.length) return <Empty text="Nothing waiting to ship. 📦" />;
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-white">
      {orders.map((o) => {
        const busy = busyKeys.has(`ship:${o.orderId}`) || busyKeys.has(`cancel:${o.orderId}`);
        const rowError = [rowErr[`ship:${o.orderId}`], rowErr[`cancel:${o.orderId}`]].filter(Boolean).join(" · ") || undefined;
        return (
          <RowShell key={o.orderId} err={rowError}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{o.lineItems.map((li) => li.title).join(" · ")}</div>
                <div className="figures mt-0.5 text-[11px] text-ink/50">
                  {[o.buyer, [o.shipTo.name, [o.shipTo.city, o.shipTo.state].filter(Boolean).join(", "), o.shipTo.zip].filter(Boolean).join(" · "),
                    new Date(o.createdAt).toLocaleDateString()].filter(Boolean).join(" — ")}
                </div>
              </div>
              <span className="figures shrink-0 text-sm font-bold">{money(o.total)}</span>
            </div>
            <div className="mt-2 flex gap-2">
              <select value={carrier[o.orderId] ?? "USPS"} onChange={(e) => setCarrier((p) => ({ ...p, [o.orderId]: e.target.value }))}
                className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-flag">
                {["USPS", "UPS", "FedEx", "DHL", "Other"].map((c) => <option key={c}>{c}</option>)}
              </select>
              <input value={tracking[o.orderId] ?? ""} onChange={(e) => setTracking((p) => ({ ...p, [o.orderId]: e.target.value }))}
                placeholder="Tracking number"
                className="figures flex-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-flag" />
              <button disabled={busy || !(tracking[o.orderId] ?? "").trim()}
                onClick={() => onShip(o, carrier[o.orderId] ?? "USPS", (tracking[o.orderId] ?? "").trim())}
                className="flex items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />} Shipped
              </button>
            </div>
            {/* Cancel order (refunds the buyer; reverses any settled sale) */}
            <div className="mt-1.5 flex items-center gap-2">
              {cancelling === o.orderId ? (
                <>
                  <span className="text-[11px] text-ink/50">Cancel &amp; refund —</span>
                  <MiniBtn tone="danger" disabled={busy} onClick={() => { setCancelling(null); onCancel(o, "OUT_OF_STOCK_OR_CANNOT_FULFILL"); }}>
                    Can&apos;t fulfill
                  </MiniBtn>
                  <MiniBtn disabled={busy} onClick={() => { setCancelling(null); onCancel(o, "BUYER_ASKED_CANCEL"); }}>
                    Buyer asked
                  </MiniBtn>
                  <MiniBtn onClick={() => setCancelling(null)}><X size={12} /></MiniBtn>
                </>
              ) : (
                <button onClick={() => setCancelling(o.orderId)} disabled={busy}
                  className="text-[11px] font-semibold text-ink/40 underline-offset-2 hover:text-danger hover:underline disabled:opacity-40">
                  Cancel order
                </button>
              )}
            </div>
          </RowShell>
        );
      })}
    </div>
  );
}

// ── Buyer Best Offers ────────────────────────────────────────────────────────
function OffersTab({ hub, offers, loading, rowErr, busyKeys, onReload, onRespond }: {
  hub: Hub; offers: Record<string, BuyerOffer[]> | null; loading: boolean;
  rowErr: Record<string, string>; busyKeys: Set<string>;
  onReload: () => void;
  onRespond: (itemId: string, o: BuyerOffer, action: "accept" | "decline" | "counter", counterPrice?: number) => void;
}) {
  const [countering, setCountering] = useState<string | null>(null);
  const [counterPrice, setCounterPrice] = useState("");
  if (loading) {
    return <div className="mt-6 flex items-center justify-center gap-2 text-sm text-ink/50"><Loader2 size={15} className="animate-spin" /> Checking buyer offers…</div>;
  }
  if (rowErr.offers_tab) {
    return (
      <div className="mt-3 rounded-xl border border-danger/40 bg-danger/5 p-3">
        <p className="text-xs text-danger">{rowErr.offers_tab}</p>
        <button onClick={onReload} className="mt-2 rounded-lg border border-hairline bg-white px-3 py-1 text-xs font-semibold">Retry</button>
      </div>
    );
  }
  const entries = Object.entries(offers ?? {});
  if (!entries.length) return <Empty text="No pending buyer offers right now." />;
  return (
    <div className="mt-3 space-y-3">
      {entries.map(([itemId, list]) => {
        const listing = hub.active.find((l) => l.itemId === itemId);
        return (
          <div key={itemId} className="overflow-hidden rounded-xl border border-hairline bg-white">
            <div className="border-b border-hairline bg-paper/40 px-3 py-2 text-xs font-bold">
              {listing?.title ?? `Item ${itemId}`}
              {listing?.price != null && <span className="figures ml-2 font-semibold text-ink/40">listed {money(listing.price)}</span>}
            </div>
            {list.map((o) => {
              const busy = busyKeys.has(`bo:${o.offerId}`);
              const pctOfList = listing?.price != null && o.price != null ? Math.round((o.price / listing.price) * 100) : null;
              return (
                <RowShell key={o.offerId} err={rowErr[`bo:${o.offerId}`]}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="figures text-sm font-bold">{money(o.price)}</span>
                      {pctOfList != null && (
                        <span className={"figures ml-1.5 text-[11px] font-bold " + (pctOfList >= 85 ? "text-pos" : pctOfList >= 70 ? "text-warn" : "text-danger")}>
                          {pctOfList}% of ask
                        </span>
                      )}
                      <span className="ml-2 text-[11px] text-ink/50">from {o.buyer ?? "buyer"}</span>
                      {o.message && <p className="mt-0.5 truncate text-[11px] italic text-ink/45">&ldquo;{o.message}&rdquo;</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {busy ? <Loader2 size={13} className="animate-spin text-flag" /> : countering === o.offerId ? (
                        <>
                          <input value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} type="number" step="0.01" autoFocus placeholder="$"
                            className="figures w-20 rounded-lg border border-hairline bg-white px-2 py-1 text-xs outline-none focus:border-flag" />
                          <MiniBtn disabled={!(Number(counterPrice) > 0)} onClick={() => { setCountering(null); onRespond(itemId, o, "counter", Number(counterPrice)); }}>
                            Send
                          </MiniBtn>
                          <MiniBtn onClick={() => setCountering(null)}><X size={12} /></MiniBtn>
                        </>
                      ) : (
                        <>
                          <MiniBtn onClick={() => onRespond(itemId, o, "accept")}><Check size={11} /> Accept</MiniBtn>
                          <MiniBtn onClick={() => { setCountering(o.offerId); setCounterPrice(""); }}>Counter</MiniBtn>
                          <MiniBtn tone="danger" onClick={() => onRespond(itemId, o, "decline")}>Decline</MiniBtn>
                        </>
                      )}
                    </div>
                  </div>
                </RowShell>
              );
            })}
          </div>
        );
      })}
      <button onClick={onReload} className="flex items-center gap-1.5 text-xs font-semibold text-ink/40 hover:text-ink">
        <RefreshCw size={12} /> Re-check offers
      </button>
    </div>
  );
}

// ── Sold orders ──────────────────────────────────────────────────────────────
function SoldTab({ orders, busyKeys, rowErr, onSync }: {
  orders: Order[]; busyKeys: Set<string>; rowErr: Record<string, string>; onSync: () => void;
}) {
  const syncing = busyKeys.has("sync");
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink/45">
          Paid eBay orders (90d). Syncing settles each matched card into your books — real price, real fees, pool basis drawn.
        </p>
        <button onClick={onSync} disabled={syncing}
          className="ml-3 flex shrink-0 items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync &amp; settle
        </button>
      </div>
      {rowErr.sync && <p className="mt-1.5 text-[11px] text-danger">{rowErr.sync}</p>}
      {!orders.length ? <Empty text="No paid orders in the last 90 days." /> : (
        <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
          {orders.map((o) => (
            <RowShell key={o.orderId}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{o.lineItems.map((li) => li.title).join(" · ")}</div>
                  <div className="figures mt-0.5 text-[11px] text-ink/50">
                    {new Date(o.createdAt).toLocaleDateString()} · {o.buyer ?? "buyer"} · {o.fulfillmentStatus === "FULFILLED" ? "shipped" : "not shipped"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="figures block text-sm font-bold">{money(o.total)}</span>
                  {o.settled ? (
                    <span className="figures text-[10px] font-bold text-pos">settled ✓</span>
                  ) : o.cardId ? (
                    <span className="figures text-[10px] font-bold text-warn">not settled</span>
                  ) : (
                    <span className="text-[10px] text-ink/30">no card match</span>
                  )}
                </div>
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Loading / error shells for the lazy tabs ─────────────────────────────────
function TabLoading({ text }: { text: string }) {
  return <div className="mt-6 flex items-center justify-center gap-2 text-sm text-ink/50"><Loader2 size={15} className="animate-spin" /> {text}</div>;
}
function TabError({ text, onReload }: { text: string; onReload: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-danger/40 bg-danger/5 p-3">
      <p className="text-xs text-danger">{text}</p>
      <button onClick={onReload} className="mt-2 rounded-lg border border-hairline bg-white px-3 py-1 text-xs font-semibold">Retry</button>
    </div>
  );
}

// ── Buyer messages inbox ─────────────────────────────────────────────────────
function MessagesTab({ messages, loading, rowErr, busyKeys, onReload, onReply }: {
  messages: Msg[] | null; loading: boolean; rowErr: Record<string, string>; busyKeys: Set<string>;
  onReload: () => void; onReply: (m: Msg, text: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (loading) return <TabLoading text="Loading your eBay inbox…" />;
  if (rowErr.messages_tab) return <TabError text={rowErr.messages_tab} onReload={onReload} />;
  if (!messages?.length) return <Empty text="No buyer messages in the last 14 days." />;
  return (
    <div className="mt-3 space-y-2">
      {messages.map((m) => {
        const busy = busyKeys.has(`msg:${m.messageId}`);
        const canReply = Boolean(m.itemId && m.sender);
        return (
          <div key={m.messageId} className="overflow-hidden rounded-xl border border-hairline bg-white">
            <button onClick={() => setOpenId(openId === m.messageId ? null : m.messageId)} className="w-full px-3 py-2.5 text-left">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{m.subject || "(no subject)"}</span>
                <span className="shrink-0 text-[10px] text-ink/40">{m.date ? new Date(m.date).toLocaleDateString() : ""}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink/50">
                <span>from {m.sender ?? "buyer"}</span>
                {m.responded && <span className="figures rounded bg-pos/12 px-1 py-px font-bold text-pos">answered</span>}
              </div>
              {openId !== m.messageId && m.body && <p className="mt-1 truncate text-[11px] text-ink/45">{m.body}</p>}
            </button>
            {openId === m.messageId && (
              <div className="border-t border-hairline px-3 py-2.5">
                <p className="whitespace-pre-wrap text-[13px] leading-snug text-ink/80">{m.body || "(no body)"}</p>
                {m.itemId && (
                  <a href={`https://www.ebay.com/itm/${m.itemId}`} target="_blank" rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-flag hover:underline">
                    item {m.itemId} <ExternalLink size={10} />
                  </a>
                )}
                {canReply ? (
                  <div className="mt-2">
                    <textarea value={draft[m.messageId] ?? ""} onChange={(e) => setDraft((p) => ({ ...p, [m.messageId]: e.target.value }))}
                      rows={2} placeholder="Reply to the buyer…"
                      className="w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm outline-none focus:border-flag" />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button disabled={busy || !(draft[m.messageId] ?? "").trim()}
                        onClick={() => onReply(m, (draft[m.messageId] ?? "").trim())}
                        className="flex items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send reply
                      </button>
                      {rowErr[`msg:${m.messageId}`] && <span className="text-[11px] text-danger">{rowErr[`msg:${m.messageId}`]}</span>}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-ink/40">Can&apos;t reply here (no linked item/sender) — open it on eBay.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button onClick={onReload} className="flex items-center gap-1.5 text-xs font-semibold text-ink/40 hover:text-ink">
        <RefreshCw size={12} /> Re-check inbox
      </button>
    </div>
  );
}

// ── Feedback (reviews) ───────────────────────────────────────────────────────
const DEFAULT_THANKS = "Great buyer — fast payment, smooth transaction. Thank you! A+";

function FeedbackTab({ feedback, loading, rowErr, busyKeys, orders, onReload, onReply, onLeave }: {
  feedback: FeedbackData | null; loading: boolean; rowErr: Record<string, string>; busyKeys: Set<string>;
  orders: Order[]; onReload: () => void;
  onReply: (c: FeedbackComment, text: string) => void;
  onLeave: (o: Order, text: string) => void;
}) {
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [leaveText, setLeaveText] = useState<Record<string, string>>({});
  if (loading) return <TabLoading text="Loading your feedback…" />;
  if (rowErr.feedback_tab) return <TabError text={rowErr.feedback_tab} onReload={onReload} />;

  const typeTone = (t: string | null) =>
    t === "Positive" ? "text-pos" : t === "Negative" ? "text-danger" : "text-warn";
  const buyers = orders.filter((o) => o.buyer && o.lineItems[0]?.legacyItemId).slice(0, 20);

  return (
    <div className="mt-3 space-y-4">
      {/* Score */}
      <div className="flex items-center gap-4 rounded-xl border border-hairline bg-white p-4">
        <div>
          <div className="figures text-2xl font-bold text-flag">{feedback?.score ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-ink/50">Score</div>
        </div>
        <div>
          <div className="figures text-2xl font-bold text-pos">{feedback?.positivePct != null ? `${feedback.positivePct}%` : "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-ink/50">Positive</div>
        </div>
      </div>

      {/* Leave feedback for buyers */}
      {buyers.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">Thank your buyers</div>
          <div className="overflow-hidden rounded-xl border border-hairline bg-white">
            {buyers.map((o) => {
              const busy = busyKeys.has(`leave:${o.orderId}`);
              return (
                <RowShell key={o.orderId} err={rowErr[`leave:${o.orderId}`]}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{o.buyer}</div>
                      <div className="truncate text-[11px] text-ink/45">{o.lineItems.map((li) => li.title).join(" · ")}</div>
                    </div>
                    <button disabled={busy} onClick={() => onLeave(o, (leaveText[o.orderId] ?? DEFAULT_THANKS).trim() || DEFAULT_THANKS)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-bold text-pos disabled:opacity-50">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />} Leave +
                    </button>
                  </div>
                  <input value={leaveText[o.orderId] ?? DEFAULT_THANKS} onChange={(e) => setLeaveText((p) => ({ ...p, [o.orderId]: e.target.value }))}
                    maxLength={80}
                    className="mt-1.5 w-full rounded-lg border border-hairline bg-white px-2 py-1 text-[11px] outline-none focus:border-flag" />
                </RowShell>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-ink/35">eBay only lets sellers leave positive feedback. Duplicates are rejected by eBay.</p>
        </div>
      )}

      {/* Received comments */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">Recent reviews about you</div>
        {!feedback?.comments.length ? <Empty text="No feedback received yet." /> : (
          <div className="overflow-hidden rounded-xl border border-hairline bg-white">
            {feedback.comments.map((c) => {
              const busy = busyKeys.has(`fb:${c.feedbackId}`);
              return (
                <RowShell key={c.feedbackId || `${c.user}-${c.time}`} err={rowErr[`fb:${c.feedbackId}`]}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={"text-[11px] font-bold uppercase " + typeTone(c.type)}>{c.type ?? "—"}</span>
                      <span className="ml-2 text-[11px] text-ink/50">{c.user ?? "buyer"}</span>
                      {c.text && <p className="mt-0.5 text-[13px] leading-snug text-ink/80">{c.text}</p>}
                    </div>
                    {!c.responded && c.feedbackId && (
                      <MiniBtn disabled={busy} onClick={() => { setReplyId(c.feedbackId); setReplyText(""); }}>Reply</MiniBtn>
                    )}
                    {c.responded && <span className="shrink-0 text-[10px] font-bold text-ink/30">replied</span>}
                  </div>
                  {replyId === c.feedbackId && (
                    <div className="mt-2 flex items-center gap-2">
                      <input value={replyText} onChange={(e) => setReplyText(e.target.value)} autoFocus maxLength={80} placeholder="Public reply…"
                        className="flex-1 rounded-lg border border-hairline bg-white px-2 py-1 text-xs outline-none focus:border-flag" />
                      <MiniBtn disabled={busy || !replyText.trim()} onClick={() => { setReplyId(null); onReply(c, replyText.trim()); }}>
                        {busy ? <Loader2 size={12} className="animate-spin" /> : "Post"}
                      </MiniBtn>
                      <MiniBtn onClick={() => setReplyId(null)}><X size={12} /></MiniBtn>
                    </div>
                  )}
                </RowShell>
              );
            })}
          </div>
        )}
      </div>

      <button onClick={onReload} className="flex items-center gap-1.5 text-xs font-semibold text-ink/40 hover:text-ink">
        <RefreshCw size={12} /> Refresh feedback
      </button>
    </div>
  );
}
