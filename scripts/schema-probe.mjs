#!/usr/bin/env node
// IS THE DEPLOYED SCHEMA THE ONE THE CODE EXPECTS? (2026-10-28)
//
// Written after the bug it would have caught. On 2026-10-28 every comp paste in
// production was failing with `column card_market_sales.private_to does not
// exist`: the write path in `market-sales.ts` sets `private_to`, migration
// 20260752 creates it, and 20260752 had never been pasted. Typecheck passed,
// 841 tests passed, the production build was clean, and the registry showed no
// drift — because NONE OF THEM CAN SEE THE DATABASE.
//
// That is the gap this fills. `component-check.mjs` compares the repo against
// itself; this compares the repo against the live project. The distinction that
// matters is not code-vs-migrations (the migration file was present and
// correct) but MIGRATIONS-ON-DISK vs MIGRATIONS-APPLIED, which no static check
// can reach.
//
// NEEDS NO SECRETS. It asks PostgREST for one column at a time and reads the
// error code; `42703` is "column does not exist" and comes back whether or not
// the caller can see any rows. With no key in the environment it lifts the
// PUBLIC anon key out of the deployed client bundle — the same key every
// visitor's browser already holds — so it works from a clean checkout.
//
// Read-only. It selects at most one row and never writes.
//
//   node scripts/schema-probe.mjs
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... node scripts/schema-probe.mjs

const PROD = "https://card-ops-zeta.vercel.app";
const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://zgkydwvmdnnrxcacegth.supabase.co";

// Columns the CODE writes or reads, and the migration that creates each.
// Add a row here whenever a migration adds a column the app depends on; the
// point is that the claim is checkable instead of remembered.
const EXPECTED = [
  { table: "card_market_sales", column: "price",       migration: "20260723 (base table)" },
  { table: "card_market_sales", column: "identity_id", migration: "20260738 card_identities" },
  { table: "card_market_sales", column: "provenance",  migration: "20260750 sale_provenance" },
  { table: "card_market_sales", column: "added_by",    migration: "20260750 sale_provenance" },
  { table: "card_market_sales", column: "price_basis", migration: "20260750 sale_provenance" },
  { table: "card_market_sales", column: "is_graded",   migration: "20260750 sale_provenance" },
  { table: "card_market_sales", column: "private_to",  migration: "20260752 source_instances" },
  { table: "card_market_rollups", column: "provenances", migration: "20260750 sale_provenance" },
  { table: "card_source_configs", column: "credential_ref", migration: "20260752 source_instances" },
  { table: "card_data_sources",   column: "kind",          migration: "20260752 source_instances" },
];

// A column that cannot exist. If this does NOT report missing, the probe is
// not actually distinguishing anything and every other result is worthless.
const CANARY = { table: "card_market_sales", column: "zzz_probe_canary_do_not_create" };

async function publicKey() {
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const html = await fetch(`${PROD}/login`).then((r) => r.text());
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]))];
  for (const c of chunks.slice(0, 30)) {
    const js = await fetch(PROD + c).then((r) => r.text()).catch(() => "");
    const m = js.match(/sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/);
    if (m) return m[0];
  }
  return null;
}

/** "present" | "missing" | "no-such-table" | "unknown:<detail>" */
async function probe(key, table, column) {
  const url = `${PROJECT_URL}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=1`;
  let res, body;
  try {
    res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    body = await res.text();
  } catch (e) {
    return `unknown:${e instanceof Error ? e.message : "fetch failed"}`;
  }
  if (res.ok) return "present";
  let j = null;
  try { j = JSON.parse(body); } catch { /* non-JSON error body */ }
  if (j?.code === "42703") return "missing";
  // PostgREST answers 404/PGRST205 for a table absent from its schema cache;
  // Postgres own code 42P01 can surface too. Both mean the table is not there.
  if (j?.code === "42P01" || j?.code === "PGRST205") return "no-such-table";
  // RLS denial still proves the column parsed, so the column is there.
  if (res.status === 401 || res.status === 403) return "present";
  return `unknown:${res.status} ${j?.code ?? body.slice(0, 80)}`;
}

const key = await publicKey();
if (!key) {
  console.error("No anon key: set NEXT_PUBLIC_SUPABASE_ANON_KEY, or check that " + PROD + " is reachable.");
  process.exit(2);
}

console.log(`schema-probe → ${PROJECT_URL}\n`);

const canary = await probe(key, CANARY.table, CANARY.column);
if (canary !== "missing") {
  // Fail loudly rather than report a clean bill of health the method cannot
  // support (prevention rule 3: a read that failed is never a result).
  console.error(`CANARY FAILED: a column that cannot exist reported "${canary}".`);
  console.error("The probe is not distinguishing present from missing — results would be meaningless.");
  process.exit(2);
}

let missing = 0, unknown = 0;
for (const e of EXPECTED) {
  const r = await probe(key, e.table, e.column);
  const mark = r === "present" ? "ok  " : r === "missing" || r === "no-such-table" ? "GONE" : "??  ";
  if (r === "missing" || r === "no-such-table") missing++;
  else if (r !== "present") unknown++;
  console.log(`  ${mark} ${e.table}.${e.column}${r === "present" ? "" : `  — ${r}, needs ${e.migration}`}`);
}

console.log("");
if (missing) {
  console.error(`${missing} expected object(s) are NOT in the live database.`);
  console.error("Paste the named migration(s). Until then any code path writing them fails at runtime,");
  console.error("which typecheck, tests and the build all pass straight through.");
}
if (unknown) console.error(`${unknown} probe(s) were inconclusive — re-run before trusting this.`);
if (!missing && !unknown) console.log("Live schema matches what the code expects.");
process.exit(missing || unknown ? 1 : 0);
