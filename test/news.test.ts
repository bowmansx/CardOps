import { describe, it, expect } from "vitest";
import { subjectsFromCards, googleNewsRssUrl, parseRssItems, type NewsCard } from "../src/lib/cards/news";

describe("subjectsFromCards", () => {
  it("dedupes by player and appends the game for TCG singles", () => {
    const cards: NewsCard[] = [
      { id: "1", player: "Victor Wembanyama", set_name: "Prizm", sport_category: "Basketball" },
      { id: "2", player: "Victor Wembanyama", set_name: "Select", sport_category: "Basketball" }, // dup
      { id: "3", player: "Ragavan", set_name: "Modern Horizons 2", sport_category: "MTG" },
    ];
    const subs = subjectsFromCards(cards);
    expect(subs).toHaveLength(2);
    expect(subs[0].query).toBe("Victor Wembanyama"); // sports = plain name
    expect(subs[1].query).toBe("Ragavan MTG"); // TCG = name + game
  });
  it("skips too-short names and respects the cap", () => {
    const cards: NewsCard[] = [
      { id: "1", player: "Yz", set_name: null, sport_category: null }, // too short
      { id: "2", player: "Player A", set_name: null, sport_category: null },
      { id: "3", player: "Player B", set_name: null, sport_category: null },
    ];
    expect(subjectsFromCards(cards, 1)).toHaveLength(1);
    expect(subjectsFromCards(cards).map((s) => s.subject)).not.toContain("Yz");
  });
});

describe("googleNewsRssUrl", () => {
  it("encodes the query", () => {
    expect(googleNewsRssUrl("Ragavan MTG")).toContain("q=Ragavan%20MTG");
  });
});

describe("parseRssItems", () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[Wembanyama drops 40 - ESPN]]></title>
      <link>https://news.google.com/rss/articles/abc</link>
      <pubDate>Sat, 20 Jul 2026 12:00:00 GMT</pubDate>
      <source url="https://espn.com">ESPN</source>
    </item>
    <item>
      <title>Ragavan banned in Legacy - MTG Nexus</title>
      <link>https://news.google.com/rss/articles/def</link>
      <pubDate>Fri, 19 Jul 2026 08:00:00 GMT</pubDate>
      <source url="https://mtgnexus.com">MTG Nexus</source>
    </item>
  </channel></rss>`;

  it("extracts title, url, source, date and strips the publisher suffix", () => {
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Wembanyama drops 40"); // " - ESPN" trimmed
    expect(items[0].source).toBe("ESPN");
    expect(items[0].url).toContain("abc");
    expect(items[1].title).toBe("Ragavan banned in Legacy");
  });
  it("respects the limit", () => {
    expect(parseRssItems(xml, 1)).toHaveLength(1);
  });
});
