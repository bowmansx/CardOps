import { describe, it, expect } from "vitest";
import {
  isManual, nextManualReason, showAiOffBanner,
  type IntakeModeEvent, type ManualReason,
} from "@/lib/cards/intake-mode";

// "Enter manually" and the server's "AI is off" reply used to set the same flag,
// so choosing manual entry showed a banner telling Beau to turn AI on in
// Services, even when it was on.

describe("intake manual reason", () => {
  it("choosing Enter manually is manual entry, but never claims AI is off", () => {
    expect(isManual("chosen")).toBe(true);
    expect(showAiOffBanner("chosen")).toBe(false);
  });

  it("the server's AI-off reply is manual entry AND points at the Services switch", () => {
    expect(isManual("ai-off")).toBe(true);
    expect(showAiOffBanner("ai-off")).toBe(true);
  });

  it("an AI-filled scan is neither", () => {
    expect(isManual(null)).toBe(false);
    expect(showAiOffBanner(null)).toBe(false);
  });

  it("only one reason ever raises the banner", () => {
    const all: ManualReason[] = [null, "ai-off", "chosen"];
    expect(all.filter(showAiOffBanner)).toEqual(["ai-off"]);
  });
});

// The predicates above can't catch the original bug: it lived in the handler
// that SET the reason. FullIntake now sets it only through nextManualReason, so
// these pin each event to its state, from every state the form can be in.
describe("intake manual reason transitions", () => {
  const every: ManualReason[] = [null, "ai-off", "chosen"];
  const run = (events: IntakeModeEvent[], from: ManualReason = null) =>
    events.reduce(nextManualReason, from);

  it("Enter manually never produces the server's AI-off state", () => {
    for (const from of every) {
      const to = nextManualReason(from, { type: "chose-manual" });
      expect(to).toBe("chosen");
      expect(showAiOffBanner(to)).toBe(false);
      expect(isManual(to)).toBe(true);
    }
  });

  it("only a scan reply saying aiOff raises the Services banner", () => {
    for (const from of every) {
      const to = nextManualReason(from, { type: "scan-replied", aiOff: true });
      expect(to).toBe("ai-off");
      expect(showAiOffBanner(to)).toBe(true);
    }
  });

  it("a scan that filled the form clears both, even after AI was off", () => {
    for (const from of every) {
      expect(nextManualReason(from, { type: "scan-replied", aiOff: false })).toBe(null);
    }
  });

  it("a failed scan leaves the reason alone and never invents AI-off", () => {
    for (const from of every) {
      expect(nextManualReason(from, { type: "scan-failed" })).toBe(from);
    }
  });

  it("scan fails (say, no API key), then Enter manually: no banner", () => {
    const to = run([{ type: "scan-failed" }, { type: "chose-manual" }]);
    expect(to).toBe("chosen");
    expect(showAiOffBanner(to)).toBe(false);
  });

  it("reset returns to an AI-ready form from any state", () => {
    for (const from of every) {
      expect(nextManualReason(from, { type: "reset" })).toBe(null);
    }
  });
});
