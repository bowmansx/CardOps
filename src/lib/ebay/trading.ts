import { EBAY_HOSTS } from "./oauth";

// eBay's legacy Trading API — everything the modern REST APIs can't do:
// auctions (Inventory API is fixed-price-only), Best Offer negotiation on
// live listings, end/relist, and the unified my-selling view. XML in,
// regex-parsed XML out; eBay's real errors surface verbatim.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Safe to embed inside <![CDATA[ … ]]>: split any literal "]]>" so it can't
// close the section early (the standard CDATA-escape).
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

async function tradingCall(
  access: string,
  callName: string,
  innerXml: string,
): Promise<{ ok: boolean; body: string; errors: string | null; warnings: string | null }> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>Low</WarningLevel>
  ${innerXml}
</${callName}Request>`;
  const res = await fetch(`${EBAY_HOSTS.api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": access,
      "Content-Type": "text/xml",
    },
    body: xml,
  });
  const body = await res.text();
  const ack = /<Ack>([^<]+)<\/Ack>/.exec(body)?.[1];
  const messages = [...body.matchAll(/<LongMessage>([^<]*)<\/LongMessage>/g)].map((m) => m[1]);
  const ok = ack === "Success" || ack === "Warning";
  return {
    ok,
    body,
    errors: ok ? null : messages.join(" · ") || `Trading API ${callName} ${res.status}: ${body.slice(0, 300)}`,
    warnings: ack === "Warning" ? messages.join(" · ") || null : null,
  };
}

// Pull a tag's text from within a block. Returns null when absent.
const tag = (block: string, name: string): string | null =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(block)?.[1] ?? null;

export type AuctionInput = {
  title: string;
  description: string;
  sku: string;
  categoryId: string;
  conditionId: string; // "4000" raw · "2750" graded
  startBid: number;
  days: 3 | 5 | 7 | 10;
  binPrice?: number | null;
  postalCode: string;
  pictureUrls: string[];
  aspects: Record<string, string[]>;
  policies: { fulfillment: string; payment: string; return: string };
};

export async function addAuctionItem(
  access: string,
  a: AuctionInput,
): Promise<{ ok: true; itemId: string; warnings: string | null } | { ok: false; error: string }> {
  const specifics = Object.entries(a.aspects)
    .map(
      ([name, values]) =>
        `<NameValueList><Name>${esc(name)}</Name>${values.map((v) => `<Value>${esc(v)}</Value>`).join("")}</NameValueList>`,
    )
    .join("");
  const pictures = a.pictureUrls.slice(0, 12).map((u) => `<PictureURL>${esc(u)}</PictureURL>`).join("");

  const r = await tradingCall(access, "AddItem", `<Item>
    <Title>${esc(a.title)}</Title>
    <Description>${cdata(a.description)}</Description>
    <SKU>${esc(a.sku)}</SKU>
    <PrimaryCategory><CategoryID>${a.categoryId}</CategoryID></PrimaryCategory>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>${a.conditionId}</ConditionID>
    <StartPrice currencyID="USD">${a.startBid.toFixed(2)}</StartPrice>
    ${a.binPrice ? `<BuyItNowPrice currencyID="USD">${a.binPrice.toFixed(2)}</BuyItNowPrice>` : ""}
    <ListingType>Chinese</ListingType>
    <ListingDuration>Days_${a.days}</ListingDuration>
    <Country>US</Country>
    <Currency>USD</Currency>
    <PostalCode>${esc(a.postalCode)}</PostalCode>
    <Quantity>1</Quantity>
    <PictureDetails>${pictures}</PictureDetails>
    <ItemSpecifics>${specifics}</ItemSpecifics>
    <SellerProfiles>
      <SellerShippingProfile><ShippingProfileID>${esc(a.policies.fulfillment)}</ShippingProfileID></SellerShippingProfile>
      <SellerPaymentProfile><PaymentProfileID>${esc(a.policies.payment)}</PaymentProfileID></SellerPaymentProfile>
      <SellerReturnProfile><ReturnProfileID>${esc(a.policies.return)}</ReturnProfileID></SellerReturnProfile>
    </SellerProfiles>
    <Site>US</Site>
  </Item>`);
  const itemId = /<ItemID>(\d+)<\/ItemID>/.exec(r.body)?.[1];
  if (r.ok && itemId) return { ok: true, itemId, warnings: r.warnings };
  return { ok: false, error: r.errors ?? "AddItem returned no ItemID." };
}

export type MySelling = {
  itemId: string;
  title: string;
  sku: string | null;
  price: number | null;       // current bid for auctions, asking price for BIN
  binPrice: number | null;
  format: "auction" | "fixed";
  timeLeft: string | null;    // human "2d 3h"
  endsAt: string | null;
  watchers: number | null;
  bids: number | null;
  quantity: number | null;
  photo: string | null;
  bestOfferEnabled: boolean;
};

// "P2DT3H14M9S" → "2d 3h" (or "14m" inside the last hour).
export function humanTimeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/.exec(iso);
  if (!m) return null;
  const [, d, h, min] = m;
  if (d && Number(d) > 0) return `${d}d${h && Number(h) > 0 ? ` ${h}h` : ""}`;
  if (h && Number(h) > 0) return `${h}h${min && Number(min) > 0 ? ` ${min}m` : ""}`;
  if (min && Number(min) > 0) return `${min}m`;
  return "<1m";
}

function parseSellingItem(block: string): MySelling {
  const listingType = tag(block, "ListingType");
  const current = /<CurrentPrice[^>]*>([\d.]+)<\/CurrentPrice>/.exec(block)?.[1];
  const bin = /<BuyItNowPrice[^>]*>([\d.]+)<\/BuyItNowPrice>/.exec(block)?.[1];
  const timeLeftIso = tag(block, "TimeLeft");
  return {
    itemId: tag(block, "ItemID") ?? "",
    title: (tag(block, "Title") ?? "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
    sku: tag(block, "SKU"),
    price: current != null ? Number(current) : null,
    binPrice: bin != null ? Number(bin) : null,
    format: listingType === "Chinese" ? "auction" : "fixed",
    timeLeft: humanTimeLeft(timeLeftIso),
    endsAt: tag(block, "EndTime"),
    watchers: tag(block, "WatchCount") != null ? Number(tag(block, "WatchCount")) : null,
    bids: tag(block, "BidCount") != null ? Number(tag(block, "BidCount")) : null,
    quantity: tag(block, "QuantityAvailable") != null ? Number(tag(block, "QuantityAvailable")) : null,
    photo: tag(block, "GalleryURL"),
    bestOfferEnabled: /<BestOfferEnabled>true<\/BestOfferEnabled>/.test(block),
  };
}

// Unified live view of everything selling — auctions AND Inventory-API
// fixed-price listings appear here (it's the same seller account).
export async function getMyEbaySelling(
  access: string,
): Promise<{ ok: true; active: MySelling[]; unsold: MySelling[] } | { ok: false; error: string }> {
  const lists = async (which: "ActiveList" | "UnsoldList", pages: number) => {
    const out: MySelling[] = [];
    for (let page = 1; page <= pages; page++) {
      const r = await tradingCall(access, "GetMyeBaySelling", `
        <${which}><Include>true</Include>
          <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
        </${which}>`);
      if (!r.ok) throw new Error(r.errors ?? `${which} failed`);
      const section = new RegExp(`<${which}>([\\s\\S]*?)</${which}>`).exec(r.body)?.[1] ?? "";
      const items = [...section.matchAll(/<Item>([\s\S]*?)<\/Item>/g)].map((m) => parseSellingItem(m[1]));
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  };
  try {
    const [active, unsold] = [await lists("ActiveList", 3), await lists("UnsoldList", 2)];
    return { ok: true, active, unsold };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "GetMyeBaySelling failed" };
  }
}

export async function endItem(
  access: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await tradingCall(access, "EndItem",
    `<ItemID>${esc(itemId)}</ItemID><EndingReason>NotAvailable</EndingReason>`);
  return r.ok ? { ok: true } : { ok: false, error: r.errors! };
}

// Auction price revision (Trading-created listings only; eBay rejects it once
// bids exist — that error surfaces verbatim).
export async function reviseAuctionPrice(
  access: string,
  itemId: string,
  startBid: number,
  binPrice?: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await tradingCall(access, "ReviseItem", `<Item>
    <ItemID>${esc(itemId)}</ItemID>
    <StartPrice currencyID="USD">${startBid.toFixed(2)}</StartPrice>
    ${binPrice ? `<BuyItNowPrice currencyID="USD">${binPrice.toFixed(2)}</BuyItNowPrice>` : ""}
  </Item>`);
  return r.ok ? { ok: true } : { ok: false, error: r.errors! };
}

export async function relistItem(
  access: string,
  itemId: string,
): Promise<{ ok: true; itemId: string } | { ok: false; error: string }> {
  const r = await tradingCall(access, "RelistItem", `<Item><ItemID>${esc(itemId)}</ItemID></Item>`);
  const newId = /<ItemID>(\d+)<\/ItemID>/.exec(r.body)?.[1];
  if (r.ok && newId) return { ok: true, itemId: newId };
  return { ok: false, error: r.errors ?? "RelistItem returned no ItemID." };
}

export type BuyerOffer = {
  offerId: string;
  buyer: string | null;
  price: number | null;
  quantity: number | null;
  status: string | null;   // Active | Countered | …
  message: string | null;
  expires: string | null;
};

export async function getBestOffers(
  access: string,
  itemId: string,
): Promise<{ ok: true; offers: BuyerOffer[] } | { ok: false; error: string }> {
  const r = await tradingCall(access, "GetBestOffers",
    `<ItemID>${esc(itemId)}</ItemID><BestOfferStatus>Active</BestOfferStatus><DetailLevel>ReturnAll</DetailLevel>`);
  if (!r.ok) return { ok: false, error: r.errors! };
  const offers = [...r.body.matchAll(/<BestOffer>([\s\S]*?)<\/BestOffer>/g)].map((m) => {
    const b = m[1];
    const price = /<Price[^>]*>([\d.]+)<\/Price>/.exec(b)?.[1];
    return {
      offerId: tag(b, "BestOfferID") ?? "",
      buyer: tag(b, "UserID"),
      price: price != null ? Number(price) : null,
      quantity: tag(b, "Quantity") != null ? Number(tag(b, "Quantity")) : null,
      status: tag(b, "Status"),
      message: tag(b, "BuyerMessage"),
      expires: tag(b, "ExpirationTime"),
    };
  });
  return { ok: true, offers };
}

export async function respondToBestOffer(
  access: string,
  itemId: string,
  offerId: string,
  action: "Accept" | "Decline" | "Counter",
  counterPrice?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const counter =
    action === "Counter" && counterPrice
      ? `<CounterOfferPrice currencyID="USD">${counterPrice.toFixed(2)}</CounterOfferPrice><CounterOfferQuantity>1</CounterOfferQuantity>`
      : "";
  const r = await tradingCall(access, "RespondToBestOffer", `
    <ItemID>${esc(itemId)}</ItemID>
    <BestOfferID>${esc(offerId)}</BestOfferID>
    <Action>${action}</Action>
    ${counter}`);
  return r.ok ? { ok: true } : { ok: false, error: r.errors! };
}

// Rich text between two tags (bodies can hold HTML/CDATA that the simple `tag`
// helper's [^<]* would truncate). Strips CDATA wrappers + tags to plain text.
const richTag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
};

// ── Feedback (the seller "reviews" system) ──────────────────────────────────
export type FeedbackComment = {
  feedbackId: string; user: string | null; type: string | null; text: string | null;
  time: string | null; itemId: string | null; role: string | null; responded: boolean;
};
export type FeedbackSummary = {
  score: number | null; positivePct: number | null; comments: FeedbackComment[];
};

export async function getReceivedFeedback(
  access: string,
): Promise<{ ok: true; data: FeedbackSummary } | { ok: false; error: string }> {
  const r = await tradingCall(access, "GetFeedback", `<DetailLevel>ReturnAll</DetailLevel>`);
  if (!r.ok) return { ok: false, error: r.errors! };
  const score = tag(r.body, "FeedbackScore");
  const pos = tag(r.body, "PositiveFeedbackPercent");
  const comments = [...r.body.matchAll(/<FeedbackDetail>([\s\S]*?)<\/FeedbackDetail>/g)]
    .map((m) => m[1])
    .filter((b) => (tag(b, "Role") ?? "").toLowerCase() === "seller") // feedback about me as seller
    .slice(0, 40)
    .map((b) => ({
      feedbackId: tag(b, "FeedbackID") ?? "",
      user: tag(b, "CommentingUser"),
      type: tag(b, "CommentType"),
      text: richTag(b, "CommentText"),
      time: tag(b, "CommentTime"),
      itemId: tag(b, "ItemID"),
      role: tag(b, "Role"),
      responded: /<ResponseText>/.test(b) || /<Responded>true<\/Responded>/.test(b),
    }));
  return { ok: true, data: { score: score != null ? Number(score) : null, positivePct: pos != null ? Number(pos) : null, comments } };
}

// Leave positive feedback for a buyer. eBay only allows positive from sellers,
// so CommentType is fixed. Keyed by ItemID + TargetUser (the Trading identity)
// — the Sell Fulfillment lineItemId is NOT a valid OrderLineItemID, so we use
// the listing's legacy ItemID, which is what the order carries.
export async function leaveFeedback(
  access: string,
  itemId: string,
  targetUser: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await tradingCall(access, "LeaveFeedback", `
    <ItemID>${esc(itemId)}</ItemID>
    <TargetUser>${esc(targetUser)}</TargetUser>
    <CommentType>Positive</CommentType>
    <CommentText>${cdata(text.slice(0, 500))}</CommentText>`);
  return r.ok ? { ok: true } : { ok: false, error: r.errors! };
}

export async function replyToFeedback(
  access: string,
  feedbackId: string,
  targetUser: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await tradingCall(access, "RespondToFeedback", `
    <FeedbackID>${esc(feedbackId)}</FeedbackID>
    <TargetUserID>${esc(targetUser)}</TargetUserID>
    <ResponseType>Reply</ResponseType>
    <ResponseText>${cdata(text.slice(0, 500))}</ResponseText>`);
  return r.ok ? { ok: true } : { ok: false, error: r.errors! };
}

// ── Buyer messages ──────────────────────────────────────────────────────────
export type MemberMessage = {
  messageId: string; sender: string | null; subject: string | null; body: string | null;
  itemId: string | null; date: string | null; responded: boolean;
};

export async function getMemberMessages(
  access: string,
  daysBack = 14,
): Promise<{ ok: true; messages: MemberMessage[] } | { ok: false; error: string }> {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400_000);
  const r = await tradingCall(access, "GetMemberMessages", `
    <MailMessageType>All</MailMessageType>
    <StartCreationTime>${start.toISOString()}</StartCreationTime>
    <EndCreationTime>${end.toISOString()}</EndCreationTime>`);
  if (!r.ok) return { ok: false, error: r.errors! };
  const messages = [...r.body.matchAll(/<MemberMessageExchange>([\s\S]*?)<\/MemberMessageExchange>/g)]
    .map((m) => m[1])
    .slice(0, 60)
    .map((b) => ({
      messageId: tag(b, "MessageID") ?? "",
      sender: tag(b, "SenderID"),
      subject: richTag(b, "Subject"),
      body: richTag(b, "Body"),
      itemId: tag(b, "ItemID"),
      date: tag(b, "CreationDate"),
      responded: /<MessageStatus>Answered<\/MessageStatus>/.test(b),
    }))
    .filter((m) => m.messageId);
  return { ok: true, messages };
}

export async function replyToMemberMessage(
  access: string,
  itemId: string,
  parentMessageId: string,
  recipientId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await tradingCall(access, "AddMemberMessageRTQ", `
    <ItemID>${esc(itemId)}</ItemID>
    <MemberMessage>
      <Body>${cdata(body.slice(0, 2000))}</Body>
      <ParentMessageID>${esc(parentMessageId)}</ParentMessageID>
      <RecipientID>${esc(recipientId)}</RecipientID>
    </MemberMessage>`);
  return r.ok ? { ok: true } : { ok: false, error: r.errors! };
}
