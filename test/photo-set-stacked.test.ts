import { describe, it, expect } from "vitest";
import {
  stackedKind, listingPhotos, gradingPhotos, displayPhotos, photoCaption, type PhotoRow,
} from "@/lib/cards/photo-set";

const row = (o: Partial<PhotoRow> & { id: string }): PhotoRow => ({
  kind: "front", role: "front", variant: "processed", derived_from: null,
  bucket: "b", path: `p/${o.id}`, ...o,
});

const stacked = (kind: "clean" | "surface") => ({ stacked: { kind, frames: 5, meanDepth: 4.2 } });

describe("stackedKind", () => {
  it("reads the kind out of capture_meta", () => {
    expect(stackedKind({ capture_meta: stacked("surface") })).toBe("surface");
    expect(stackedKind({ capture_meta: stacked("clean") })).toBe("clean");
  });

  // An ordinary single-exposure photo has no `stacked` block at all.
  it("returns null for a plain photo", () => {
    expect(stackedKind({ capture_meta: undefined })).toBeNull();
    expect(stackedKind({ capture_meta: null })).toBeNull();
    expect(stackedKind({ capture_meta: { mode: "in_app", auto: true } })).toBeNull();
  });

  it("survives junk metadata rather than throwing", () => {
    expect(stackedKind({ capture_meta: "nonsense" })).toBeNull();
    expect(stackedKind({ capture_meta: { stacked: "yes" } })).toBeNull();
    expect(stackedKind({ capture_meta: { stacked: { kind: "wat" } } })).toBeNull();
  });
});

describe("listingPhotos never publishes a surface map", () => {
  // THE ONE FILTER HERE THAT IS ABOUT HARM. A raking-light image exists to make
  // every scratch and print line as visible as possible; published as a product
  // photo it advertises a card as damaged.
  it("excludes a surface composite from a listing", () => {
    const rows = [
      row({ id: "a", capture_meta: stacked("clean") }),
      row({ id: "b", role: "back", capture_meta: stacked("surface") }),
    ];
    expect(listingPhotos(rows).photos.map((p) => p.id)).toEqual(["a"]);
  });

  // The role is set by the TEMPLATE SLOT, so sweeping on a "front" slot gives
  // both composites the role `front`. The metadata is the only thing that can
  // tell them apart — a role-only filter would publish the surface map.
  it("excludes it even when the role says front", () => {
    const rows = [
      row({ id: "a", role: "front", capture_meta: stacked("clean") }),
      row({ id: "b", role: "front", capture_meta: stacked("surface") }),
    ];
    expect(listingPhotos(rows).photos.map((p) => p.id)).toEqual(["a"]);
  });

  it("also excludes a hand-shot surface_angle, metadata or not", () => {
    const rows = [row({ id: "a" }), row({ id: "b", role: "surface_angle" })];
    expect(listingPhotos(rows).photos.map((p) => p.id)).toEqual(["a"]);
  });

  it("keeps the glare-removed composite — that IS the product photo", () => {
    const rows = [row({ id: "a", capture_meta: stacked("clean") })];
    expect(listingPhotos(rows).photos).toHaveLength(1);
  });

  it("leaves ordinary photos completely alone", () => {
    const rows = [row({ id: "a" }), row({ id: "b", role: "back" })];
    expect(listingPhotos(rows).photos.map((p) => p.id)).toEqual(["a", "b"]);
  });

  // Truncation is measured after the exclusion, or the banner would count
  // photos that were never candidates.
  it("counts truncation against what is publishable", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row({ id: `c${i}`, role: "corner_tl" })),
      row({ id: "s", role: "back", capture_meta: stacked("surface") }),
    ];
    const r = listingPhotos(rows, 3);
    expect(r.photos).toHaveLength(3);
    expect(r.truncated).toBe(false);
  });
});

describe("gradingPhotos KEEPS the surface map", () => {
  // The mirror of the listing rule, and the reason the surface map exists: it is
  // precisely what a grader wants to see.
  it("sends it to the grader", () => {
    const rows = [
      row({ id: "a", capture_meta: stacked("clean") }),
      row({ id: "b", role: "surface_angle", capture_meta: stacked("surface") }),
    ];
    expect(gradingPhotos(rows).photos.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("stops reporting surface_angle as missing once a sweep supplied one", () => {
    const rows = [row({ id: "a" }), row({ id: "b", role: "surface_angle", capture_meta: stacked("surface") })];
    expect(gradingPhotos(rows).missing).not.toContain("surface_angle");
  });
});

describe("photoCaption", () => {
  // A grader shown a raking-light composite without being told what it is reads
  // every highlight as a defect — it makes a mint card look scuffed.
  it("warns the grader that highlights are the lighting, not damage", () => {
    const c = photoCaption(row({ id: "a", role: "surface_angle", capture_meta: stacked("surface") }));
    expect(c).toContain("SURFACE MAP");
    expect(c).toContain("not necessarily damage");
  });

  it("says a clean composite was merged, since that bears on judging surface", () => {
    expect(photoCaption(row({ id: "a", capture_meta: stacked("clean") }))).toContain("remove glare");
  });

  it("leaves an ordinary photo's caption untouched", () => {
    expect(photoCaption(row({ id: "a", role: "back" }))).toBe("Back of the card");
  });
});

describe("displayPhotos still shows both", () => {
  // The card's own page should show everything that was captured — the exclusion
  // is about PUBLISHING, not about hiding work from its owner.
  it("keeps the surface map in the card's own view", () => {
    const rows = [
      row({ id: "a", capture_meta: stacked("clean") }),
      row({ id: "b", role: "surface_angle", capture_meta: stacked("surface") }),
    ];
    expect(displayPhotos(rows).map((p) => p.id)).toEqual(["a", "b"]);
  });
});
