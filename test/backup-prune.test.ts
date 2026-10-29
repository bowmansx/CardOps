import { describe, it, expect } from "vitest";
import { runsToPrune, RUN_NAME } from "../scripts/lib/prune-runs.mjs";

const run = (day: number, complete = true) => ({
  name: `2026-10-${String(day).padStart(2, "0")}T03-00-00`,
  complete,
});

describe("runsToPrune", () => {
  it("keeps the newest N complete runs and returns the older ones, oldest first", () => {
    const entries = [run(1), run(2), run(3), run(4), run(5)];
    expect(runsToPrune(entries, 3)).toEqual([run(1).name, run(2).name]);
  });

  it("never lets failed runs push out good backups", () => {
    // Two good backups, then a fortnight of failures, then one success.
    const entries = [run(1), run(2), ...Array.from({ length: 14 }, (_, i) => run(3 + i, false)), run(17)];
    const doomed = runsToPrune(entries, 3);
    expect(doomed).toEqual([]); // only 3 complete runs exist; keep all of them
    const doomed2 = runsToPrune(entries, 2);
    expect(doomed2).toEqual([run(1).name]); // the oldest good run goes, nothing newer
  });

  it("keeps a failed run that is newer than the kept set, as evidence", () => {
    const entries = [run(1), run(2), run(3), run(4, false)];
    expect(runsToPrune(entries, 2)).toEqual([run(1).name]);
  });

  it("does nothing when there are no more complete runs than keep", () => {
    expect(runsToPrune([run(1), run(2)], 14)).toEqual([]);
    expect(runsToPrune([], 14)).toEqual([]);
  });

  it("never returns a folder that is not shaped like a run", () => {
    const entries = [
      { name: "README.md", complete: true },
      { name: "manual-copy-before-migration", complete: true },
      { name: ".gitignore", complete: true },
      run(1), run(2), run(3),
    ];
    expect(runsToPrune(entries, 1)).toEqual([run(1).name, run(2).name]);
  });

  it("refuses a keep that could delete everything", () => {
    expect(() => runsToPrune([run(1)], 0)).toThrow(/at least 1/);
    expect(() => runsToPrune([run(1)], 1.5)).toThrow(/at least 1/);
  });

  it("matches the folder names backup.mjs actually writes", () => {
    const stamp = new Date("2026-10-29T01:46:04.123Z").toISOString().replace(/[:.]/g, "-").slice(0, 19);
    expect(stamp).toBe("2026-10-29T01-46-04");
    expect(RUN_NAME.test(stamp)).toBe(true);
  });
});
