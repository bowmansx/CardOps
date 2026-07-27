#!/usr/bin/env node
/**
 * Local backup: every row, and every photo.
 *
 * WHY THIS EXISTS. The schema is safe — `supabase/bootstrap/` rebuilds it from
 * nothing and lives in git. The DATA is not. And the photos are worse than the
 * data: `pg_dump` does not touch the storage bucket at all, so for an asset
 * whose value lives in its paperwork, the evidence had no copy anywhere.
 *
 * Beau's inventory is nearly empty today, which makes this the cheapest moment
 * it will ever be to start. That stops being true the first time a real box of
 * cards goes through the scanner.
 *
 * WHAT IT IS NOT. This writes to a local folder. The off-site copy (R2 / Drive
 * / S3) is a separate decision Beau hasn't made, and pretending a folder on the
 * same laptop is a backup would be worse than admitting it isn't. The script
 * says so on every run.
 *
 *   node scripts/backup.mjs [--out DIR] [--tables-only] [--photos-only]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment (a .env.local is read if present).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ── env ────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  for (const f of [".env.local", ".env"]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}
loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
    "Put them in .env.local, or pull them with: vercel env pull .env.local",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const tablesOnly = args.includes("--tables-only");
const photosOnly = args.includes("--photos-only");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(arg("--out", path.join("backups", stamp)));

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

// Every table holding data that is not reconstructible from the repo. Ordered
// roughly parent-first so a human reading the dump can follow it.
const TABLES = [
  "profiles", "card_businesses", "cards", "purchase_lots",
  "purchase_lot_adjustments", "card_sales", "card_basis_items",
  "card_basis_item_kinds", "card_photos", "card_photo_templates",
  "card_photo_presets", "card_user_prefs", "card_identities",
  "card_market_sales", "card_source_quotes", "card_documents",
  "card_asset_records", "card_custody_log", "card_lots", "card_alerts",
  "card_watchlist", "card_storage_locations", "card_pricing_strategies",
  "card_grading_submissions", "credit_ledger", "ai_usage", "usage_events",
  "card_portfolio_snapshots", "audit_log", "user_settings",
];

const PAGE = 1000; // PostgREST caps here regardless of what we ask for

/** Read a table to completion. A short read is a FAILED read, never the end. */
async function dumpTable(name) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(name).select("*").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      // A table that doesn't exist in this project is fine and expected; any
      // other error is not, and must not be mistaken for an empty table.
      if (/does not exist|schema cache/i.test(error.message)) return { rows: null, skipped: error.message };
      throw new Error(`${name}: ${error.message}`);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows, skipped: null };
}

/** Some tables have no `id` to order by; fall back to unordered paging. */
async function dumpTableLoose(name) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(name).select("*").range(from, from + PAGE - 1);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return { rows: null, skipped: error.message };
      throw new Error(`${name}: ${error.message}`);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows, skipped: null };
}

async function backupTables() {
  fs.mkdirSync(path.join(outDir, "tables"), { recursive: true });
  const manifest = {};
  let total = 0;
  for (const t of TABLES) {
    let res;
    try {
      res = await dumpTable(t);
    } catch (e) {
      if (/column .*id.* does not exist|42703/i.test(String(e.message))) res = await dumpTableLoose(t);
      else throw e;
    }
    if (res.rows === null) {
      manifest[t] = { skipped: res.skipped };
      process.stdout.write(`  ${t}: not in this project\n`);
      continue;
    }
    fs.writeFileSync(path.join(outDir, "tables", `${t}.json`), JSON.stringify(res.rows, null, 2));
    manifest[t] = { rows: res.rows.length };
    total += res.rows.length;
    process.stdout.write(`  ${t}: ${res.rows.length}\n`);
  }
  return { manifest, total };
}

/** Walk a storage bucket recursively — list() is one directory at a time. */
async function listAll(bucket, prefix = "") {
  const out = [];
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A folder comes back with no id and no metadata.
    if (entry.id === null || entry.metadata == null) out.push(...await listAll(bucket, full));
    else out.push({ path: full, size: Number(entry.metadata?.size ?? 0) });
  }
  return out;
}

async function backupPhotos() {
  const bucket = "card-photos";
  process.stdout.write("  listing objects…\n");
  const objects = await listAll(bucket);
  const bytes = objects.reduce((n, o) => n + o.size, 0);
  process.stdout.write(`  ${objects.length} objects, ${(bytes / 1048576).toFixed(1)} MB\n`);

  let done = 0, failed = 0;
  for (const o of objects) {
    const dest = path.join(outDir, "storage", bucket, o.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const { data, error } = await db.storage.from(bucket).download(o.path);
    if (error || !data) {
      failed++;
      process.stdout.write(`  FAILED ${o.path}: ${error?.message ?? "no data"}\n`);
      continue;
    }
    fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
    done++;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${objects.length}\n`);
  }
  return { objects: objects.length, downloaded: done, failed, bytes };
}

// ── run ────────────────────────────────────────────────────────────────────
const t0 = Date.now();
fs.mkdirSync(outDir, { recursive: true });
console.log(`\nBacking up ${URL_.replace(/https:\/\/([^.]+).*/, "$1")} → ${outDir}\n`);

let tables = null, photos = null;
try {
  if (!photosOnly) { console.log("Tables:"); tables = await backupTables(); }
  if (!tablesOnly) { console.log("\nPhotos:"); photos = await backupPhotos(); }
} catch (e) {
  // A partial backup that reports success is worse than no backup, because it
  // is the one you rely on later.
  console.error(`\nBACKUP FAILED — do not treat ${outDir} as a backup.\n${e.message}`);
  fs.writeFileSync(path.join(outDir, "INCOMPLETE.txt"), `Failed ${new Date().toISOString()}\n${e.stack}\n`);
  process.exit(1);
}

const report = {
  at: new Date().toISOString(),
  project: URL_,
  seconds: Math.round((Date.now() - t0) / 1000),
  tables: tables?.manifest ?? null,
  tableRows: tables?.total ?? null,
  storage: photos,
  note: "LOCAL ONLY. This is on the same machine as nothing else. An off-site copy is a separate, unmade decision.",
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(report, null, 2));

console.log(`\nDone in ${report.seconds}s`);
if (tables) console.log(`  ${tables.total} rows across ${Object.keys(tables.manifest).length} tables`);
if (photos) {
  console.log(`  ${photos.downloaded}/${photos.objects} objects (${(photos.bytes / 1048576).toFixed(1)} MB)`);
  if (photos.failed) console.log(`  ${photos.failed} FAILED — this backup is incomplete`);
}
console.log(`\n  ${outDir}`);
console.log(`  This is a LOCAL copy. It does not survive losing this machine.\n`);
void readline;
