import { describe, it, expect } from "vitest";
import { displayPhotos, listingPhotos, gradingPhotos, roleCaption, type PhotoRow } from "@/lib/cards/photo-set";

const row = (o: Partial<PhotoRow> & { id: string }): PhotoRow => ({
  kind: null, role: null, variant: "processed", derived_from: null,
  bucket: "card-photos", path: `p/${o.id}.jpg`, ...o,
});

describe("displayPhotos", () => {
  // THE BUG THIS EXISTS FOR: each shot stores the uncropped frame AND the crop
  // derived from it. Publishing in insert order put the table-background frame
  // first — the lead image a buyer sees as the thumbnail.
  it("prefers the crop over the uncropped frame it came from", () => {
    const src = row({ id: "src", role: "front", variant: "original" });
    const crop = row({ id: "crop", role: "front", variant: "processed", derived_from: "src" });
    const out = displayPhotos([src, crop]);
    expect(out.map((p) => p.id)).toEqual(["crop"]);
  });

  it("keeps a lone original when nothing was derived from it", () => {
    const solo = row({ id: "solo", role: "front", variant: "original" });
    expect(displayPhotos([solo]).map((p) => p.id)).toEqual(["solo"]);
  });

  it("puts the whole card before the close detail", () => {
    const out = displayPhotos([
      row({ id: "c1", role: "corner_tl" }),
      row({ id: "b", role: "back" }),
      row({ id: "f", role: "front" }),
      row({ id: "s", role: "surface_angle" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["f", "b", "s", "c1"]);
  });

  it("keeps capture order within the same role", () => {
    const out = displayPhotos([
      row({ id: "tl", role: "corner_tl" }),
      row({ id: "tr", role: "corner_tr" }),
      row({ id: "bl", role: "corner_bl" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["tl", "tr", "bl"]);
  });

  it("falls back to kind when role is null (rows from before templates)", () => {
    const out = displayPhotos([row({ id: "b", kind: "back" }), row({ id: "f", kind: "front" })]);
    expect(out.map((p) => p.id)).toEqual(["f", "b"]);
  });

  it("handles no photos at all", () => {
    expect(displayPhotos(null)).toEqual([]);
    expect(displayPhotos([])).toEqual([]);
  });
});

describe("listingPhotos", () => {
  // Losing the shot of the whole card is the one truncation that makes a
  // listing worse than having no detail shots at all.
  it("caps AFTER ordering, so front and back survive the cut", () => {
    const many: PhotoRow[] = [
      ...Array.from({ length: 11 }, (_, i) => row({ id: `c${i}`, role: "corner_tl" })),
      row({ id: "front", role: "front" }),
      row({ id: "back", role: "back" }),
    ];
    const { photos, truncated } = listingPhotos(many, 12);
    expect(photos[0].id).toBe("front");
    expect(photos[1].id).toBe("back");
    expect(photos).toHaveLength(12);
    expect(truncated).toBe(true);
  });

  it("does not claim truncation when everything fits", () => {
    const { truncated } = listingPhotos([row({ id: "f", role: "front" })], 12);
    expect(truncated).toBe(false);
  });
});

describe("gradingPhotos", () => {
  it("names the views a grader wants and this card lacks", () => {
    const { missing } = gradingPhotos([row({ id: "f", role: "front" })]);
    expect(missing).toContain("back");
    expect(missing).toContain("corner_tl");
    expect(missing).not.toContain("front");
  });

  it("reports nothing missing for a full grading set", () => {
    const full = ["front", "back", "corner_tl", "corner_tr", "corner_bl", "corner_br", "surface_angle", "edge"]
      .map((role, i) => row({ id: `p${i}`, role }));
    expect(gradingPhotos(full, 8).missing).toEqual([]);
  });

  // The slab label tells you what a grader already decided; it is not evidence
  // about the card's condition.
  it("leaves the slab label out", () => {
    const out = gradingPhotos([row({ id: "f", role: "front" }), row({ id: "s", role: "slab" })]);
    expect(out.roles).not.toContain("slab");
  });

  it("flags truncation rather than quietly sending fewer views", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => row({ id: `p${i}`, role: "corner_tl" }));
    const out = gradingPhotos(twelve, 8);
    expect(out.photos).toHaveLength(8);
    expect(out.truncated).toBe(true);
  });
});

describe("roleCaption", () => {
  it("distinguishes front corners from back corners", () => {
    expect(roleCaption("corner_tl")).toContain("FRONT");
    expect(roleCaption("corner_tl_back")).toContain("BACK");
  });

  it("never returns an empty caption for an unknown role", () => {
    expect(roleCaption("something_new").length).toBeGreaterThan(0);
  });
});
