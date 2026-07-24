import { describe, it, expect } from "vitest";
import { catCode, buildSku } from "../src/lib/cards/sku";

// Split out of lib.test.ts (2026-07-24) so it lands cleanly on the CardOps side
// of the repo seam — lib.test.ts also covers allowlist + snapshot, which are
// MasterOps-only, and a test that imports both sides can't move with either.
describe("SKU", () => {
  it("maps category → code, defaulting to OT", () => {
    expect(catCode("Football")).toBe("FB");
    expect(catCode("Pokemon")).toBe("PK");
    expect(catCode("Nonsense")).toBe("OT");
    expect(catCode(null)).toBe("OT");
  });
  it("builds a zero-padded SKU", () => {
    expect(buildSku("FB", 2026, 412)).toBe("FB-2026-000412");
    expect(buildSku("OT", 2026, 1)).toBe("OT-2026-000001");
  });
});
