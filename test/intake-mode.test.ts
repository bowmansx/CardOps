import { describe, it, expect } from "vitest";
import { isManual, showAiOffBanner, type ManualReason } from "@/lib/cards/intake-mode";

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
