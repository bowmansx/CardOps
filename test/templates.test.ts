import { describe, it, expect } from "vitest";
import { normalizeShots, missingShots, shotStep, PHOTO_ROLES, type PhotoTemplate } from "@/lib/cards/templates";

const tpl = (shots: { role: string; label: string }[]): PhotoTemplate => ({
  id: "t1", key: "t", name: "T", builtIn: true, shots: normalizeShots(shots),
});

describe("normalizeShots", () => {
  it("keeps valid shots and fills a missing label from the role", () => {
    const s = normalizeShots([{ role: "corner_tl" }]);
    expect(s).toHaveLength(1);
    expect(s[0].label).toBe("Front · top-left corner");
  });

  // Silently rewriting a bad role to "other" would file a corner shot where no
  // corner-reading code will ever look for it.
  it("drops a role the database would refuse rather than coercing it", () => {
    expect(normalizeShots([{ role: "corner_middle", label: "x" }])).toEqual([]);
    expect(normalizeShots([{ role: "front" }, { role: "nope" }])).toHaveLength(1);
  });

  it("returns nothing for junk instead of throwing", () => {
    expect(normalizeShots(null)).toEqual([]);
    expect(normalizeShots("front")).toEqual([]);
    expect(normalizeShots([null, 7, "front"])).toEqual([]);
  });

  it("caps a runaway template", () => {
    const many = Array.from({ length: 60 }, () => ({ role: "front", label: "F" }));
    expect(normalizeShots(many)).toHaveLength(40);
  });

  it("trims an over-long label and hint", () => {
    const s = normalizeShots([{ role: "front", label: "L".repeat(80), hint: "H".repeat(200) }]);
    expect(s[0].label.length).toBe(40);
    expect(s[0].hint!.length).toBe(120);
  });
});

describe("missingShots", () => {
  const four = tpl([
    { role: "corner_tl", label: "TL" }, { role: "corner_tr", label: "TR" },
    { role: "corner_bl", label: "BL" }, { role: "corner_br", label: "BR" },
  ]);

  it("reports everything missing on a card with no photos", () => {
    expect(missingShots(four, [])).toHaveLength(4);
  });

  it("reports nothing missing once every role is present", () => {
    expect(missingShots(four, ["corner_tl", "corner_tr", "corner_bl", "corner_br"])).toEqual([]);
  });

  // The whole point of counting rather than checking membership: a template
  // asking for four corners is not satisfied by one corner photo.
  it("counts repeats — two FRONT shots satisfy two FRONT slots, not four", () => {
    const twoFronts = tpl([{ role: "front", label: "A" }, { role: "front", label: "B" }]);
    expect(missingShots(twoFronts, ["front"])).toHaveLength(1);
    expect(missingShots(twoFronts, ["front", "front"])).toHaveLength(0);
  });

  it("ignores photos in roles the template never asked for", () => {
    expect(missingShots(four, ["front", "back", "edge"])).toHaveLength(4);
  });
});

describe("shotStep", () => {
  it("counts from one, not zero — nobody photographs shot 0 of 12", () => {
    expect(shotStep(0, 12)).toBe("1 of 12");
    expect(shotStep(11, 12)).toBe("12 of 12");
  });
});

describe("PHOTO_ROLES", () => {
  // These MIRROR the card_photos CHECK in migration 20260740. A role here that
  // the database refuses means a template presents a shot that can't be saved,
  // and the user finds out at the end of a twelve-photo run.
  it("matches the roles the database accepts", () => {
    const fromMigration = [
      "front", "back", "slab", "defect",
      "corner_tl", "corner_tr", "corner_bl", "corner_br",
      "corner_tl_back", "corner_tr_back", "corner_bl_back", "corner_br_back",
      "surface_angle", "edge", "other",
    ];
    expect([...PHOTO_ROLES.map((r) => r.role)].sort()).toEqual([...fromMigration].sort());
  });

  it("has no duplicate roles", () => {
    const roles = PHOTO_ROLES.map((r) => r.role);
    expect(new Set(roles).size).toBe(roles.length);
  });
});
