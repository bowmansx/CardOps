import { describe, it, expect } from "vitest";
import {
  normalizePhotoPrefs, estimateBytesPerCard, humanBytes,
  PHOTO_PREF_DEFAULTS, QUALITY_SPECS, PHOTO_QUALITIES,
} from "@/lib/cards/photo-prefs";

describe("normalizePhotoPrefs", () => {
  it("returns the documented defaults for a missing row", () => {
    expect(normalizePhotoPrefs(null)).toEqual(PHOTO_PREF_DEFAULTS);
    expect(normalizePhotoPrefs(undefined)).toEqual(PHOTO_PREF_DEFAULTS);
  });

  it("keeps valid values", () => {
    const p = normalizePhotoPrefs({
      capture_mode: "os_camera", photo_quality: "archive", auto_snap: true,
      burst_count: 5, auto_crop: "tight", crop_margin_pct: 0.1,
      keep_originals: false, default_template: "grading",
    });
    expect(p.photo_quality).toBe("archive");
    expect(p.burst_count).toBe(5);
    expect(p.default_template).toBe("grading");
  });

  // A malformed preference must never stop someone photographing a card.
  it("falls back rather than throwing on junk", () => {
    const p = normalizePhotoPrefs({
      capture_mode: "telepathy", photo_quality: "ultra", auto_crop: "nope",
      burst_count: "many", crop_margin_pct: "wide", auto_snap: "yes",
    } as never);
    expect(p).toEqual(PHOTO_PREF_DEFAULTS);
  });

  // A zero margin puts the card's edge ON the image boundary — the exact
  // misrepresentation the margin exists to prevent.
  it("floors the crop margin instead of honouring zero", () => {
    expect(normalizePhotoPrefs({ crop_margin_pct: 0 }).crop_margin_pct).toBe(0.005);
    expect(normalizePhotoPrefs({ crop_margin_pct: -5 }).crop_margin_pct).toBe(0.005);
  });

  it("caps an absurd margin", () => {
    expect(normalizePhotoPrefs({ crop_margin_pct: 9 }).crop_margin_pct).toBe(0.25);
  });

  it("clamps and rounds burst count into 1..5", () => {
    expect(normalizePhotoPrefs({ burst_count: 0 }).burst_count).toBe(1);
    expect(normalizePhotoPrefs({ burst_count: 99 }).burst_count).toBe(5);
    expect(normalizePhotoPrefs({ burst_count: 2.6 }).burst_count).toBe(3);
  });

  it("treats an empty template string as none", () => {
    expect(normalizePhotoPrefs({ default_template: "" }).default_template).toBeNull();
  });
});

describe("quality specs", () => {
  it("covers every quality level", () => {
    for (const q of PHOTO_QUALITIES) expect(QUALITY_SPECS[q]).toBeTruthy();
  });

  it("gets bigger and better up the ladder", () => {
    const order = PHOTO_QUALITIES.map((q) => QUALITY_SPECS[q]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i].maxEdge).toBeGreaterThan(order[i - 1].maxEdge);
      expect(order[i].approxBytes).toBeGreaterThan(order[i - 1].approxBytes);
    }
  });
});

describe("estimateBytesPerCard", () => {
  it("doubles when originals are kept alongside crops", () => {
    const keep = normalizePhotoPrefs({ keep_originals: true, auto_crop: "margin" });
    const drop = normalizePhotoPrefs({ keep_originals: false, auto_crop: "margin" });
    expect(estimateBytesPerCard(keep)).toBe(estimateBytesPerCard(drop) * 2);
  });

  // With no crop there is no derivative, so keeping "originals" costs nothing
  // extra — the single stored frame IS the original.
  it("does not double-count when cropping is off", () => {
    const off = normalizePhotoPrefs({ keep_originals: true, auto_crop: "off" });
    expect(estimateBytesPerCard(off, 2)).toBe(QUALITY_SPECS.standard.approxBytes * 2);
  });

  it("scales with shot count — a grading template costs far more", () => {
    const p = normalizePhotoPrefs({});
    expect(estimateBytesPerCard(p, 12)).toBe(estimateBytesPerCard(p, 2) * 6);
  });

  it("archive is an order of magnitude over economy", () => {
    const eco = normalizePhotoPrefs({ photo_quality: "economy" });
    const arc = normalizePhotoPrefs({ photo_quality: "archive" });
    expect(estimateBytesPerCard(arc) / estimateBytesPerCard(eco)).toBeGreaterThan(10);
  });
});

describe("humanBytes", () => {
  it("scales the unit", () => {
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(humanBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
  it("never renders a negative size", () => {
    expect(humanBytes(-10)).toBe("0 KB");
  });
});
