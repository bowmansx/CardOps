import { describe, it, expect } from "vitest";
import { dataUrlBytes, totalBytes, fitPayload, PAYLOAD_CAP } from "@/lib/cards/payload";

const url = (bytes: number) => "data:image/jpeg;base64," + "A".repeat(bytes);

describe("dataUrlBytes", () => {
  it("measures the encoded payload, not the prefix", () => {
    expect(dataUrlBytes(url(1000))).toBe(1000);
  });

  it("does not crash on a string that isn't a data URL", () => {
    expect(dataUrlBytes("nonsense")).toBe(8);
  });
});

describe("totalBytes", () => {
  it("adds up the images actually being sent", () => {
    expect(totalBytes([url(100), url(250)])).toBe(350);
  });

  it("ignores the slots that carry no image", () => {
    expect(totalBytes([url(100), null, undefined])).toBe(100);
  });
});

describe("fitPayload", () => {
  // The whole point: a save under the cap must be left completely alone, so
  // the common path never pays for a re-encode it doesn't need.
  it("passes a small payload through untouched", async () => {
    const a = url(1000), b = url(2000);
    const r = await fitPayload([a, b]);
    expect(r.shrunk).toBe(false);
    expect(r.urls).toEqual([a, b]);
    expect(r.to).toBe(r.from);
  });

  it("keeps positions and nulls so callers can destructure straight back", async () => {
    const r = await fitPayload([url(10), null, url(20), undefined]);
    expect(r.urls).toHaveLength(4);
    expect(r.urls[1]).toBeNull();
    expect(r.urls[3]).toBeNull();
  });

  // In Node there is no canvas, so every shrink attempt returns the original.
  // It must still RESOLVE with the images intact — a failed optimisation may
  // never be the reason a card can't be saved.
  it("returns the images unharmed when re-encoding isn't possible", async () => {
    const big = url(PAYLOAD_CAP + 1000);
    const r = await fitPayload([big]);
    expect(r.shrunk).toBe(true);
    expect(r.urls[0]).toBe(big);
  });

  it("reports the sizes it moved between, for an honest message", async () => {
    const r = await fitPayload([url(PAYLOAD_CAP + 5)]);
    expect(r.from).toBe(PAYLOAD_CAP + 5);
    expect(typeof r.to).toBe("number");
  });

  it("treats an empty set as nothing to do", async () => {
    const r = await fitPayload([null, undefined]);
    expect(r.shrunk).toBe(false);
    expect(r.from).toBe(0);
  });
});
