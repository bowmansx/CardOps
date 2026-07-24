import { describe, it, expect } from "vitest";
import { coerceDate } from "@/lib/books/date";

const TODAY = "2026-07-21";

describe("coerceDate", () => {
  it("passes a real calendar day through unchanged", () => {
    expect(coerceDate("2026-02-28", TODAY)).toBe("2026-02-28");
    expect(coerceDate("2024-02-29", TODAY)).toBe("2024-02-29"); // leap day
  });

  it("falls back to today for impossible days the shape-regex would allow", () => {
    expect(coerceDate("2026-13-45", TODAY)).toBe(TODAY); // month 13, day 45
    expect(coerceDate("2026-02-30", TODAY)).toBe(TODAY); // Feb 30 rolls over
    expect(coerceDate("2025-02-29", TODAY)).toBe(TODAY); // not a leap year
    expect(coerceDate("2026-00-10", TODAY)).toBe(TODAY); // month 0
    expect(coerceDate("2026-04-31", TODAY)).toBe(TODAY); // April has 30
  });

  it("falls back to today for wrong shapes / missing input", () => {
    expect(coerceDate(undefined, TODAY)).toBe(TODAY);
    expect(coerceDate(null, TODAY)).toBe(TODAY);
    expect(coerceDate("", TODAY)).toBe(TODAY);
    expect(coerceDate("not-a-date", TODAY)).toBe(TODAY);
    expect(coerceDate("2026-7-1", TODAY)).toBe(TODAY); // unpadded
    expect(coerceDate("2026-07-21T10:00:00Z", TODAY)).toBe(TODAY); // has time
  });

  it("uses the real today when no override is given", () => {
    const out = coerceDate("2026-13-45");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
