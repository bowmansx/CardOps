// Card news (Beau, 2026-07-20). Pure helpers for the news pipeline: derive the
// subjects to search (players / card names), build a free Google News RSS query,
// and parse the RSS. The cron does the fetch + AI scoring + push. No I/O here.

export type NewsCard = {
  id: string;
  player: string | null;
  set_name: string | null;
  sport_category: string | null;
};

export type Subject = { subject: string; query: string; cardId: string };

const TCG = /pokemon|mtg|magic|lorcana|yugioh|yu-gi-oh|riftbound|one ?piece|tcg|gathering/i;

/** Distinct subjects to search — one per player/card name, with a sample card.
 *  A TCG single gets its game appended for disambiguation ("Ragavan MTG"). */
export function subjectsFromCards(cards: NewsCard[], cap = 15): Subject[] {
  const seen = new Map<string, Subject>();
  for (const c of cards) {
    const name = (c.player ?? "").trim();
    if (name.length < 3) continue;
    const isTcg = TCG.test(c.sport_category ?? "") || TCG.test(c.set_name ?? "");
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const query = isTcg ? `${name} ${(c.sport_category ?? "TCG").trim()}` : name;
    seen.set(key, { subject: name, query, cardId: c.id });
    if (seen.size >= cap) break;
  }
  return [...seen.values()];
}

/** Free Google News RSS search URL — no key required. */
export function googleNewsRssUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

export type RssItem = { title: string; url: string; source: string | null; publishedAt: string | null };

const strip = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .trim();

const pick = (block: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? strip(m[1]) : null;
};

/** Parse Google News RSS <item> entries. Google appends " - Publisher" to
 *  titles; we keep the headline and read the publisher from <source>. */
export function parseRssItems(xml: string, limit = 10): RssItem[] {
  const items: RssItem[] = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[0];
    const rawTitle = pick(block, "title");
    const url = pick(block, "link");
    if (!rawTitle || !url) continue;
    const source = pick(block, "source");
    // Trim a trailing " - Publisher" that Google appends when we know the source.
    let title = rawTitle;
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    items.push({ title, url, source, publishedAt: pick(block, "pubDate") });
  }
  return items;
}
