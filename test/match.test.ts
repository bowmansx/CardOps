import { describe, it, expect } from "vitest";
import {
  norm, normNumber, setsAgree, namesAgree, scoreCard, findMatches, confidenceOf,
  type MatchCard,
} from "@/lib/cards/match";

const card = (o: Partial<MatchCard> & { id: string }): MatchCard => o;

const chase: MatchCard = {
  id: "a", sku: "CO-1",
  player: "Ja'Marr Chase", year: 2021, set_name: "Panini Prizm",
  card_number: "307", parallel: "Silver",
};

describe("normalisers", () => {
  it("flattens punctuation and case", () => {
    expect(norm("Ja'Marr Chase")).toBe("ja marr chase");
    expect(norm(null)).toBe("");
  });

  it("treats a printed card number the same however it is written", () => {
    expect(normNumber("#012")).toBe(normNumber("12"));
    expect(normNumber("RC-12")).toBe("rc12");
    // A letter prefix is identity, not decoration.
    expect(normNumber("RC-12")).not.toBe(normNumber("12"));
  });
});

describe("setsAgree", () => {
  it("matches what vision reads against what a person typed", () => {
    expect(setsAgree("Prizm", "Panini Prizm")).toBe(true);
    expect(setsAgree("2022 Prizm Football", "Prizm")).toBe(true);
    expect(setsAgree("Topps Chrome", "Topps Series 1")).toBe(false);
  });

  it("is false when either side is blank — silence is not agreement", () => {
    expect(setsAgree("", "Prizm")).toBe(false);
    expect(setsAgree(null, null)).toBe(false);
  });
});

describe("namesAgree", () => {
  it("survives the spellings the same name arrives in", () => {
    expect(namesAgree("Ja'Marr Chase", "JaMarr Chase")).toBe(true);
    expect(namesAgree("J. Chase", "Ja'Marr Chase")).toBe(true);
  });

  it("does not merge two players who share a surname", () => {
    expect(namesAgree("Ja'Marr Chase", "Rachaad Chase")).toBe(false);
  });
});

describe("scoreCard", () => {
  it("scores a full agreement at 1 and says which fields agreed", () => {
    const s = scoreCard(chase, { player: "Ja'Marr Chase", year: "2021", set_name: "Prizm", card_number: "307" });
    expect(s.score).toBe(1);
    expect(s.reasons).toEqual(expect.arrayContaining(["player", "year", "set", "card number"]));
    expect(s.conflicts).toEqual([]);
  });

  // Vision returns empty strings for anything it could not read. Counting that
  // against a candidate buries the right card behind whichever row happened to
  // be sparse enough to have nothing to disagree about.
  it("ignores fields either side left blank rather than penalising them", () => {
    const s = scoreCard(chase, { player: "Ja'Marr Chase", set_name: "", card_number: "", year: "" });
    expect(s.score).toBe(1);
    expect(s.reasons).toEqual(["player"]);
  });

  it("scores partial agreement below full and records the conflict", () => {
    const s = scoreCard(chase, { player: "Ja'Marr Chase", year: "2022", set_name: "Prizm", card_number: "307" });
    expect(s.score).toBeLessThan(1);
    expect(s.conflicts).toEqual(["year"]);
  });

  it("calls a cert-number agreement decisive", () => {
    const slab = card({ id: "s", cert_number: "12345678", player: "Someone Else" });
    // Printed with a dash on one side and without on the other.
    const s = scoreCard(slab, { cert_number: "1234-5678", player: "Someone Else" });
    expect(s.decisive).toBe(true);
    expect(confidenceOf(s)).toBe("certain");
  });

  // Two slabs cannot share a cert number, so a conflict there is the whole
  // answer no matter how much else lines up.
  it("kills a candidate whose cert number disagrees, however much else matches", () => {
    const slab = card({ ...chase, id: "s", cert_number: "111" });
    const s = scoreCard(slab, {
      player: "Ja'Marr Chase", year: "2021", set_name: "Prizm", card_number: "307", cert_number: "222",
    });
    expect(s.score).toBe(0);
  });
});

describe("findMatches", () => {
  const inventory: MatchCard[] = [
    chase,
    card({ id: "b", player: "Ja'Marr Chase", year: 2021, set_name: "Donruss Optic", card_number: "101" }),
    card({ id: "c", player: "Justin Jefferson", year: 2020, set_name: "Panini Prizm", card_number: "398" }),
  ];

  it("puts the right card first and drops the year-only coincidences", () => {
    const out = findMatches(inventory, { player: "JaMarr Chase", year: "2021", set_name: "Prizm", card_number: "307" });
    expect(out[0].card.id).toBe("a");
    expect(out.map((m) => m.card.id)).not.toContain("c");
  });

  // An inventory of two thousand cards always contains SOMETHING that shares a
  // year. Offering it is worse than saying nothing on the flow this exists for.
  it("returns nothing rather than a weak guess", () => {
    // A perfect 1.0 on the only comparable field, and still useless: every
    // 2021 card in the collection would qualify.
    expect(findMatches(inventory, { year: "2021" })).toEqual([]);
    expect(findMatches(inventory, { parallel: "Silver", year: "2021" })).toEqual([]);
  });

  it("still answers a player-only query — that one narrows something", () => {
    expect(findMatches(inventory, { player: "Ja'Marr Chase" }).map((m) => m.card.id)).toEqual(["a", "b"]);
  });

  it("returns nothing when the query itself is empty", () => {
    expect(findMatches(inventory, { player: "", year: "", set_name: "" })).toEqual([]);
    expect(findMatches(inventory, {})).toEqual([]);
  });

  it("floats a decisive match above a higher-scoring ordinary one", () => {
    const withCert = card({ id: "z", cert_number: "999", player: "Nobody" });
    const out = findMatches([...inventory, withCert], {
      cert_number: "999", player: "Nobody",
      // …while another card agrees on everything it can be compared on.
    });
    expect(out[0].card.id).toBe("z");
    expect(out[0].decisive).toBe(true);
  });

  it("orders stably when two candidates tie", () => {
    const twins = [card({ id: "y", player: "Same Name" }), card({ id: "x", player: "Same Name" })];
    expect(findMatches(twins, { player: "Same Name" }).map((m) => m.card.id)).toEqual(["x", "y"]);
  });
});

describe("confidenceOf", () => {
  it("needs several agreeing fields and no conflict before it says likely", () => {
    const strong = scoreCard(chase, { player: "Ja'Marr Chase", set_name: "Prizm", card_number: "307", year: "2021" });
    expect(confidenceOf(strong)).toBe("likely");
    const thin = scoreCard(chase, { player: "Ja'Marr Chase" });
    expect(confidenceOf(thin)).toBe("possible");
  });
});
