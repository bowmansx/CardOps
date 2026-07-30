import { describe, it, expect } from "vitest";
import { normalizeShots } from "@/lib/cards/templates";

describe("normalizeShots — the sweep flag", () => {
  it("carries an explicit sweep through", () => {
    const [s] = normalizeShots([{ role: "front", label: "FRONT", sweep: true }]);
    expect(s.sweep).toBe(true);
  });

  // A sweep makes the camera BEHAVE differently — it arms itself and starts
  // collecting. That has to be something the template asked for, not something
  // inferred from a hint that happens to mention sweeping.
  it("refuses anything that isn't literally true", () => {
    for (const v of ["true", 1, "yes", {}, null]) {
      const [s] = normalizeShots([{ role: "front", label: "F", sweep: v }]);
      expect(s.sweep, JSON.stringify(v)).toBeUndefined();
    }
  });

  it("leaves ordinary shots unflagged", () => {
    const [s] = normalizeShots([{ role: "edge", label: "EDGES", hint: "sweep along the edge" }]);
    expect(s.sweep).toBeUndefined();
  });

  it("survives a round trip through JSON, as a stored template does", () => {
    const stored = JSON.parse(JSON.stringify([
      { role: "front", label: "FRONT SWEEP", sweep: true, hint: "Arc slowly" },
      { role: "edge", label: "EDGES" },
    ]));
    const shots = normalizeShots(stored);
    expect(shots.map((x) => x.sweep)).toEqual([true, undefined]);
  });
});
