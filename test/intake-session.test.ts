import { describe, it, expect } from "vitest";
import {
  addToSession, removeFromSession, sessionLabel, sessionSummary, sessionPace,
  type SessionCard,
} from "@/lib/cards/intake-session";

const card = (id: string, at = 0, photosAttached = true): SessionCard => ({
  id, sku: `CO-${id}`, label: `card ${id}`, thumb: null, at, photosAttached,
});

describe("addToSession", () => {
  it("puts the newest first — what you just did is what you are most likely to fix", () => {
    const l = addToSession(addToSession([], card("a")), card("b"));
    expect(l.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("re-adding the same card moves it rather than duplicating it", () => {
    const l = addToSession(addToSession(addToSession([], card("a")), card("b")), card("a"));
    expect(l.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("removeFromSession", () => {
  it("drops only the named card", () => {
    const l = [card("a"), card("b"), card("c")];
    expect(removeFromSession(l, "b").map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("is a no-op for an id that is not there", () => {
    const l = [card("a")];
    expect(removeFromSession(l, "zz")).toEqual(l);
  });
});

describe("sessionLabel", () => {
  it("builds from whatever identity survived the scan", () => {
    expect(sessionLabel({ year: 2021, set_name: "Prizm", player: "Ja'Marr Chase", card_number: "307" }))
      .toBe("2021 Prizm Ja'Marr Chase #307");
  });

  it("copes with a partial read", () => {
    expect(sessionLabel({ player: "Ja'Marr Chase" })).toBe("Ja'Marr Chase");
    expect(sessionLabel({ year: 2021, card_number: "307" })).toBe("2021 #307");
  });

  // A placeholder here would appear in the list as though it were a name.
  // Returning null makes the caller decide what an unidentified card looks like.
  it("returns null rather than inventing a placeholder", () => {
    expect(sessionLabel({})).toBeNull();
    expect(sessionLabel({ year: null, set_name: "", player: "  " })).toBeNull();
  });
});

describe("sessionSummary", () => {
  it("counts cards booked without their photos", () => {
    const s = sessionSummary([card("a", 0, true), card("b", 0, false), card("c", 0, false)]);
    expect(s.total).toBe(3);
    expect(s.missingPhotos).toBe(2);
  });

  it("has no span until there are two cards", () => {
    expect(sessionSummary([]).spanMinutes).toBeNull();
    expect(sessionSummary([card("a")]).spanMinutes).toBeNull();
  });

  it("measures the span in whole minutes, floored at one", () => {
    const t = 1_000_000_000_000;
    const s = sessionSummary([card("a", t), card("b", t + 6 * 60_000)], t + 6 * 60_000);
    expect(s.spanMinutes).toBe(6);
  });
});

describe("sessionPace", () => {
  // Three cards in ninety seconds extrapolates to 120/hour, which is a number
  // nobody should be shown.
  it("stays silent until the run is long enough to mean anything", () => {
    expect(sessionPace({ total: 3, missingPhotos: 0, spanMinutes: 1 })).toBeNull();
    expect(sessionPace({ total: 20, missingPhotos: 0, spanMinutes: null })).toBeNull();
    expect(sessionPace({ total: 20, missingPhotos: 0, spanMinutes: 1 })).toBeNull();
  });

  it("reports cards per hour once there is a real run", () => {
    expect(sessionPace({ total: 10, missingPhotos: 0, spanMinutes: 20 })).toBe(30);
  });
});
