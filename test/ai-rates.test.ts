import { describe, it, expect } from "vitest";
import { costUsd, rateFor } from "@/lib/ai/rates";

describe("AI cost rates", () => {
  it("prices a plain haiku call (list $1 in / $5 out per MTok)", () => {
    // 10k in + 1k out = $0.01 + $0.005
    expect(costUsd("claude-haiku-4-5-20251001", { input_tokens: 10_000, output_tokens: 1_000 })).toBeCloseTo(0.015, 9);
  });

  it("resolves date-suffixed model ids by prefix", () => {
    expect(rateFor("claude-haiku-4-5-20251001")).toEqual(rateFor("claude-haiku-4-5"));
    expect(rateFor("claude-opus-4-8")).toEqual({ in: 5, out: 25 });
  });

  it("bills cache writes at 1.25× and reads at 0.1× the input rate", () => {
    const cost = costUsd("claude-opus-4-8", {
      input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 1_000_000, // 5 × 1.25 = $6.25
      cache_read_input_tokens: 1_000_000,     // 5 × 0.10 = $0.50
    });
    expect(cost).toBeCloseTo(6.75, 9);
  });

  it("returns null for an unknown model — never a silent $0 (rule 9)", () => {
    expect(costUsd("some-future-model", { input_tokens: 5, output_tokens: 5 })).toBeNull();
    expect(rateFor("gpt-oops")).toBeNull();
  });

  it("treats input_tokens as the uncached remainder (no double count)", () => {
    // 100k uncached in + 100k cache-read on opus: $0.50 + $0.05
    const cost = costUsd("claude-opus-4-8", {
      input_tokens: 100_000, output_tokens: 0, cache_read_input_tokens: 100_000,
    });
    expect(cost).toBeCloseTo(0.55, 9);
  });
});
