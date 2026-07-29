#!/usr/bin/env node
// What is actually IN this app? — regenerated, never hand-written.
//
// WHY THIS EXISTS. Over two days, five separate times, Beau asked for something
// that turned out to be already built, and neither of us knew:
//
//   • card_intake_sessions / card_intake_items — designed day one, never wired
//   • card_groups + a full CRUD API — "let's start a groups section"
//   • TAG_FACETS — "let's add tags", while derived tags were already on screen
//   • CardBrowser's `grouped` toggle — already grouping by sport
//   • cards.storage_location — already the answer to "where does it live"
//
// A hand-written inventory would go stale in a week and then lie, which is
// worse than not having one. This walks the repo instead, so it cannot drift:
// what it says exists, exists.
//
// It writes ONE file, in plain language, for Beau to read in Obsidian. The
// point is not completeness — it is that "does this already exist?" becomes a
// question with an answer.
//
//   node scripts/app-map.mjs

import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "spec", "app", "WHAT-EXISTS.md");

/** Every file under dir matching a predicate, recursively. */
function walk(dir, pred, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, pred, acc);
    else if (pred(full)) acc.push(full);
  }
  return acc;
}

const rel = (f) => relative(ROOT, f).split(sep).join("/");

// ── tables, from the generated bootstrap (one source, already authoritative)
function tables() {
  const out = new Map();
  for (const f of walk(join(ROOT, "supabase", "bootstrap"), (p) => p.endsWith(".sql"))) {
    const sql = readFileSync(f, "utf8");
    for (const m of sql.matchAll(/create table if not exists public\.([a-z0-9_]+)\s*\(([^;]*?)\n\);/gis)) {
      const [, name, body] = m;
      if (!out.has(name)) {
        const cols = [...body.matchAll(/^\s{2}([a-z0-9_]+)\s+/gim)].map((c) => c[1]);
        out.set(name, cols);
      }
    }
  }
  return out;
}

// ── routes, from the app/ shells (a src route with no shell does not exist)
function routes() {
  const pages = [], apis = [];
  for (const f of walk(join(ROOT, "app"), (p) => /(?:page|route)\.tsx?$/.test(p))) {
    const r = rel(f).replace(/^app\//, "/").replace(/\/(page|route)\.tsx?$/, "") || "/";
    (r.startsWith("/api") ? apis : pages).push(r);
  }
  return { pages: pages.sort(), apis: apis.sort() };
}

// ── lib modules, described by the first line of their own header comment
function libs() {
  return walk(join(ROOT, "src", "lib", "cards"), (p) => p.endsWith(".ts"))
    .map((f) => {
      const src = readFileSync(f, "utf8");
      const first = src.split("\n").find((l) => l.trim().startsWith("//") && l.trim().length > 6);
      const exports = [...src.matchAll(/^export (?:async )?function ([a-zA-Z0-9_]+)/gm)].map((m) => m[1]);
      return {
        file: rel(f),
        name: f.split(sep).pop().replace(/\.ts$/, ""),
        summary: (first ?? "").replace(/^\s*\/\/\s?/, "").trim(),
        exports,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── tables the TypeScript never names.
//
// NOT the same as "dead", and the difference matters. A table can be written
// entirely by a SQL function — purchase_lot_adjustments is appended by
// card_sell and card_unsell and never appears in src/, which is correct design
// rather than an oversight. So the two are reported separately: driven by SQL,
// versus referenced by nothing at all. Calling the first group dead would be
// exactly the confident-wrong claim this file exists to prevent.
function unreferenced(tableNames) {
  const src = walk(join(ROOT, "src"), (p) => /\.tsx?$/.test(p))
    .map((f) => readFileSync(f, "utf8")).join("\n");
  const sql = walk(join(ROOT, "supabase", "migrations"), (p) => p.endsWith(".sql"))
    .map((f) => readFileSync(f, "utf8")).join("\n");
  const notInTs = [...tableNames].filter((t) => !src.includes(t));
  // REPORTS EVIDENCE, DOES NOT RULE. A first version tried to sort these into
  // "SQL-driven" and "orphaned" by mention count, and got it wrong immediately:
  // card_intake_sessions and card_grading_submissions are known-dead and still
  // scored high, because tenancy-hardening loops list every table name in an
  // array. A regex cannot tell a real SQL use from a name in a list, so it
  // stops pretending to and shows the count instead.
  const uses = (t) => (sql.match(new RegExp(`\\b${t}\\b`, "g")) ?? []).length;
  return notInTs.map((t) => ({ table: t, sqlMentions: uses(t) }))
    .sort((a, b) => a.sqlMentions - b.sqlMentions);
}

const T = tables();
const R = routes();
const L = libs();
const D = unreferenced(T.keys());

const md = `# What exists — the app, as it actually is

**Generated by \`scripts/app-map.mjs\`. Do not edit — regenerate.**

Written because "does this already exist?" kept having a surprising answer.
Five times in two days a request turned out to be for something already built.
A hand-written list would go stale and then lie; this one walks the repo, so
what it says exists, exists.

*Last generated from the working tree. Counts: ${T.size} tables, ${R.pages.length} pages, ${R.apis.length} API routes, ${L.length} card modules.*

---

## Tables the app code never names

**Read this section first** — it is the cheapest place to look before building
something new. Each of these exists in the database and no TypeScript in
\`src/\` mentions it.

That does NOT mean dead. A table written entirely by a SQL function is correct
design, not an oversight — \`purchase_lot_adjustments\` is appended by
\`card_sell\` and \`card_unsell\`, and the app never touching it directly is the
point. So the SQL mention count is shown rather than a verdict: a low count
usually means nothing uses it, a high one usually means SQL does. **Usually —
check before concluding.** Tenancy-hardening loops list every table name in an
array, which inflates the count for tables that are genuinely dead.

| Table | Mentions in migrations |
|---|---|
${D.map((d) => `| \`${d.table}\` | ${d.sqlMentions} |`).join("\n")}

---

## Screens

${R.pages.map((p) => `- \`${p}\``).join("\n")}

## API routes

${R.apis.map((p) => `- \`${p}\``).join("\n")}

---

## The card modules, and what each is for

Each summary is the module's own first comment line — so if it reads badly,
the fix is in the file, not here.

${L.map((m) => `### \`${m.name}\`\n\n${m.summary || "_(no header comment)_"}\n\n${
  m.exports.length ? `Does: ${m.exports.map((e) => `\`${e}\``).join(", ")}` : "_(no exported functions)_"
}\n`).join("\n")}

---

## Every table

${[...T.entries()].sort().map(([name, cols]) =>
  `- **\`${name}\`** — ${cols.length ? cols.slice(0, 14).join(", ") + (cols.length > 14 ? ` … +${cols.length - 14} more` : "") : "_(columns not parsed)_"}`
).join("\n")}
`;

mkdirSync(join(ROOT, "spec", "app"), { recursive: true });
writeFileSync(OUT, md, "utf8");
console.log(`app map: ${T.size} tables, ${R.pages.length} pages, ${R.apis.length} routes, ${L.length} modules`);
console.log(`${D.length} table(s) no TypeScript names:`);
for (const d of D) console.log(`  ${String(d.sqlMentions).padStart(3)} sql mentions  ${d.table}`);
console.log(`wrote ${rel(OUT)}`);
