#!/usr/bin/env node
// Keep COMPONENTS.md honest (2026-07-30).
//
// A hand-written inventory of "what have we started" rots in a fortnight — the
// code moves and the document does not, and the first time it is wrong nobody
// trusts it again. This checks it both ways:
//
//   1. Every `Files:` path an entry claims must exist. A component pointing at a
//      deleted module is a lie about what is built.
//   2. Every module in src/lib/cards and src/components/cards must be claimed by
//      SOME entry. An unclaimed module is work nobody is tracking — which is
//      exactly the thing Beau asked to stop losing.
//
// Direction 2 is the one that earns its keep. Forgetting to add a component is
// silent; this makes it loud.
//
// Exits non-zero on drift so it can gate a commit if that is ever wanted.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DOC = "spec/strategy/COMPONENTS.md";
const WATCHED = ["src/lib/cards", "src/components/cards"];

// Modules that are deliberately not components in their own right: shared types,
// tiny helpers, and things whose home component obviously owns them. Listed
// explicitly rather than pattern-matched, so adding one is a decision.
const NOT_A_COMPONENT = new Set([
  "types", "img", "roles", "settings", "sku", "skudb", "zpl", "digest",
  "use-photo-prefs", "photo-prefs", "evidence",
  "card-intel-schema", "grade-estimate-schema", "grading-prompt",
]);

function read(p) {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch { return null; }
}

const doc = read(DOC);
if (!doc) {
  console.error(`MISSING: ${DOC}`);
  process.exit(1);
}

// Parse `### id`, `**Status:** x`, `**Files:** \`a\`, \`b\``
const entries = [];
let cur = null;
for (const line of doc.split(/\r?\n/)) {
  const h = line.match(/^###\s+(\S+)/);
  if (h) { cur = { id: h[1], status: null, files: [] }; entries.push(cur); continue; }
  if (!cur) continue;
  const s = line.match(/^\*\*Status:\*\*\s*(\w+)/);
  if (s) cur.status = s[1];
  const f = line.match(/^\*\*Files:\*\*\s*(.+)$/);
  if (f) cur.files = [...f[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

const VALID = new Set(["shipped", "partial", "stalled", "designed", "discussed"]);
const problems = [];

for (const e of entries) {
  if (!e.status) problems.push(`${e.id}: no Status line`);
  else if (!VALID.has(e.status)) problems.push(`${e.id}: unknown status "${e.status}"`);
  // A shipped or partial component that names no file is describing a wish.
  if ((e.status === "shipped" || e.status === "partial") && !e.files.length) {
    problems.push(`${e.id}: status "${e.status}" but claims no files`);
  }
  for (const f of e.files) {
    if (!fs.existsSync(path.join(ROOT, f))) problems.push(`${e.id}: claims missing file ${f}`);
  }
}

// Direction 2: what exists and is claimed by nobody.
const claimed = new Set(entries.flatMap((e) => e.files));
const unclaimed = [];
for (const dir of WATCHED) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) continue;
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const stem = name.replace(/\.(ts|tsx)$/, "");
    if (NOT_A_COMPONENT.has(stem)) continue;
    if (!claimed.has(rel)) unclaimed.push(rel);
  }
}

const byStatus = {};
for (const e of entries) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;

console.log(`COMPONENTS.md — ${entries.length} entries`);
console.log(Object.entries(byStatus).map(([k, v]) => `  ${String(v).padStart(3)} ${k}`).join("\n"));

if (problems.length) {
  console.log(`\nBROKEN CLAIMS (${problems.length}):`);
  for (const p of problems) console.log(`  ${p}`);
}

if (unclaimed.length) {
  console.log(`\nUNTRACKED — exists in the repo, no component claims it (${unclaimed.length}):`);
  for (const u of unclaimed) console.log(`  ${u}`);
  console.log("\n  Either add an entry, or add the stem to NOT_A_COMPONENT with a reason.");
}

if (!problems.length && !unclaimed.length) console.log("\nNo drift.");
process.exit(problems.length || unclaimed.length ? 1 : 0);
