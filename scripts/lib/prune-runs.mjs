/**
 * Which backup runs to delete, so that the newest `keep` COMPLETE runs survive.
 *
 * A run is a folder under backups/ named by its UTC start time
 * (2026-10-29T01-46-04). A run is complete when it wrote manifest.json and did
 * not write INCOMPLETE.txt; scripts/backup.mjs writes the manifest only after
 * every table and photo is saved.
 *
 * Counting folders instead of complete runs would be the dangerous version: two
 * weeks of failed nights followed by one success would keep the failures and
 * prune every good backup. So only complete runs count toward `keep`, and
 * nothing at or after the oldest kept complete run is ever returned (a recent
 * failure stays as evidence of what went wrong).
 *
 * Anything not shaped like a run is never returned, so a folder someone put in
 * backups/ by hand cannot be deleted by this.
 */
export const RUN_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/**
 * @param {{ name: string, complete: boolean }[]} entries
 * @param {number} keep
 * @returns {string[]} names to delete, oldest first
 */
export function runsToPrune(entries, keep) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`keep must be a whole number of at least 1, got ${keep}`);
  }
  const runs = entries.filter((e) => RUN_NAME.test(e.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
  const complete = runs.filter((e) => e.complete);
  if (complete.length <= keep) return [];
  const oldestKept = complete[complete.length - keep].name;
  return runs.filter((e) => e.name < oldestKept).map((e) => e.name);
}
