import { describe, it, expect } from "vitest";
import { sessionToShots, existingSlots, nextOpen, reorder, type CapturedShot } from "@/lib/cards/session";
import { normalizeShots } from "@/lib/cards/templates";

const cap = (url: string, original: string | null = `${url}-full`): CapturedShot => ({
  url, original,
  meta: { mode: "in_app", auto: true, sharp: 120, marginPct: 6 },
});

const q = (...roles: string[]) => normalizeShots(roles.map((role) => ({ role, label: role })));

describe("sessionToShots", () => {
  it("writes the pair for each captured slot, crop after its original", () => {
    const out = sessionToShots(q("front", "back"), [cap("f"), cap("b")]);
    expect(out.map((s) => s.dataUrl)).toEqual(["f-full", "f", "b-full", "b"]);
    expect(out.map((s) => s.variant)).toEqual(["original", "processed", "original", "processed"]);
  });

  it("skips slots nobody photographed", () => {
    const out = sessionToShots(q("front", "back", "edge"), [cap("f"), null, cap("e")]);
    expect(out.map((s) => s.kind)).toEqual(["front", "front", "edge", "edge"]);
  });

  // The whole reason this is computed at the end. Reorder a session and every
  // crop must still point at ITS OWN frame, not at whatever now sits before it.
  it("keeps every crop pointed at its own original after a reorder", () => {
    const queue = q("front", "back", "edge");
    const caps = [cap("f"), cap("b"), cap("e")];
    const moved = sessionToShots(reorder(queue, 2, 0), reorder(caps, 2, 0));
    expect(moved.map((s) => s.dataUrl)).toEqual(["e-full", "e", "f-full", "f", "b-full", "b"]);
    for (const s of moved.filter((x) => x.variant === "processed")) {
      expect(moved[s.derivedFromIndex!].dataUrl).toBe(`${s.dataUrl}-full`);
    }
  });

  it("keeps the links right after a delete too", () => {
    const queue = q("front", "back", "edge");
    const caps = [cap("f"), cap("b"), cap("e")];
    const out = sessionToShots(queue.filter((_, i) => i !== 0), caps.filter((_, i) => i !== 0));
    expect(out[1].derivedFromIndex).toBe(0);
    expect(out[3].derivedFromIndex).toBe(2);
  });

  // A library pick has no camera frame behind it. Claiming one would leave a
  // crop link pointing at an image that does not exist.
  it("records a library pick as the original itself, with no crop link", () => {
    const out = sessionToShots(q("front"), [cap("lib", null)]);
    expect(out).toHaveLength(1);
    expect(out[0].variant).toBe("original");
    expect(out[0].derivedFromIndex).toBeUndefined();
    expect(out[0].cropGeometry).toBeNull();
  });

  it("is empty when nothing was taken", () => {
    expect(sessionToShots(q("front", "back"), [null, null])).toEqual([]);
  });

  // "the order of your session ... will also be the order of how your photos
  // are saved" — so position is the SLOT, and a crop shares one with the frame
  // it came from. Numbering the flat payload instead would split a single shot
  // across two positions and leave gaps wherever a slot went unshot.
  it("stamps the slot on both halves of a shot, gaps and all", () => {
    const out = sessionToShots(q("front", "back", "edge"), [cap("f"), null, cap("e")]);
    expect(out.map((s) => s.position)).toEqual([0, 0, 2, 2]);
  });

  it("renumbers from the new order after a reorder", () => {
    const out = sessionToShots(reorder(q("front", "back"), 1, 0), reorder([cap("f"), cap("b")], 1, 0));
    expect(out.map((s) => [s.kind, s.position])).toEqual([
      ["back", 0], ["back", 0], ["front", 1], ["front", 1],
    ]);
  });
});

describe("existingSlots", () => {
  it("counts by role — one corner photo does not satisfy four corner slots", () => {
    const queue = q("corner_tl", "corner_tl", "front");
    expect(existingSlots(queue, ["corner_tl", "front"])).toEqual([true, false, true]);
  });

  it("marks nothing when the card has no photos", () => {
    expect(existingSlots(q("front", "back"), [])).toEqual([false, false]);
  });
});

describe("nextOpen", () => {
  it("moves to the next empty slot", () => {
    expect(nextOpen([cap("a"), null, null], 0)).toBe(1);
  });

  // Jump back to retake shot 1, and the run must still pick up the gap at the
  // end rather than declaring itself finished.
  it("wraps rather than falling off the end", () => {
    expect(nextOpen([cap("a"), cap("b"), null], 1)).toBe(2);
    expect(nextOpen([null, cap("b"), cap("c")], 2)).toBe(0);
  });

  it("returns -1 only when every slot is filled", () => {
    expect(nextOpen([cap("a"), cap("b")], 0)).toBe(-1);
    expect(nextOpen([], 0)).toBe(-1);
  });
});

describe("reorder", () => {
  it("moves one item and leaves the input alone", () => {
    const src = ["a", "b", "c", "d"];
    expect(reorder(src, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(reorder(src, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(src).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an unchanged copy for a no-op or an out-of-range index", () => {
    expect(reorder(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
});
