import { describe, it, expect } from "vitest";
import { normalizeShots, missingShots, shotStep, guideToTarget, PHOTO_ROLES, type PhotoTemplate } from "@/lib/cards/templates";

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

describe("proximity and angle targets", () => {
  it("keeps targets that are plausible", () => {
    const s = normalizeShots([{ role: "corner_tl", targetFill: 0.3, targetTilt: 0, tolerance: 0.05 }]);
    expect(s[0].targetFill).toBe(0.3);
    expect(s[0].targetTilt).toBe(0);
    expect(s[0].tolerance).toBe(0.05);
  });

  // Clamping 300% to 100% would silently invent a requirement nobody wrote.
  it("drops an impossible target rather than clamping it", () => {
    const s = normalizeShots([{ role: "front", targetFill: 3, targetTilt: 400 }]);
    expect(s[0].targetFill).toBeUndefined();
    expect(s[0].targetTilt).toBeUndefined();
  });

  it("a shot with no targets stays valid", () => {
    expect(normalizeShots([{ role: "front" }])[0].targetFill).toBeUndefined();
  });
});

describe("guideToTarget", () => {
  it("says nothing when the shot states no target", () => {
    const g = guideToTarget(undefined, { fill: 0.2, tilt: 40 });
    expect(g.message).toBeNull();
    expect(g.fill).toBe("none");
  });

  it("tells you to move closer when the card is too small", () => {
    const g = guideToTarget({ targetFill: 0.6 }, { fill: 0.2, tilt: 0 });
    expect(g.message).toBe("Move closer");
    expect(g.fill).toBe("low");
    expect(g.onTarget).toBe(false);
  });

  it("tells you to move back when it fills too much", () => {
    expect(guideToTarget({ targetFill: 0.3 }, { fill: 0.8, tilt: 0 }).message).toBe("Move back");
  });

  it("is on target inside the tolerance", () => {
    const g = guideToTarget({ targetFill: 0.6 }, { fill: 0.58, tilt: null });
    expect(g.onTarget).toBe(true);
    expect(g.message).toBeNull();
  });

  // One instruction at a time — a HUD saying three things is one nobody acts on.
  it("speaks about distance before angle", () => {
    const g = guideToTarget({ targetFill: 0.6, targetTilt: 0 }, { fill: 0.2, tilt: 40 });
    expect(g.message).toBe("Move closer");
  });

  it("moves on to angle once distance is settled", () => {
    const g = guideToTarget({ targetFill: 0.6, targetTilt: 0 }, { fill: 0.6, tilt: 40 });
    expect(g.message).toBe("Hold the phone flatter");
  });

  it("names the angle it wants when the target is a deliberate tilt", () => {
    const g = guideToTarget({ targetTilt: 35 }, { fill: null, tilt: 5 });
    expect(g.message).toContain("35");
  });

  // A target the reading cannot measure must not produce an instruction —
  // inventing "tilt flatter" from a null sends someone chasing a number that
  // was never taken.
  it("says nothing about an axis it could not measure", () => {
    const g = guideToTarget({ targetTilt: 0 }, { fill: null, tilt: null });
    expect(g.message).toBeNull();
    expect(g.tilt).toBe("none");
  });

  it("is not on target when nothing was measured", () => {
    expect(guideToTarget({ targetFill: 0.6 }, { fill: null, tilt: null }).onTarget).toBe(false);
  });
});
