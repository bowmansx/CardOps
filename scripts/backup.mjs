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

// Tables are DISCOVERED from the live API, not listed here.
//
// A hardcoded list is a backup whose coverage depends on someone remembering to
// edit it. Master-Ops had exactly that: a list written in July, 32 tables added
// after it, none of them backed up — including its double-entry ledger — while
// the nightly job reported success 74 times running. Same trap, same script
// shape, so this one discovers instead.
//
// PostgREST publishes the full table set at the API root as an OpenAPI doc,
// AND flags every column that forms part of a primary key. We need both: the
// names so coverage cannot rot, the keys so paging is deterministic.
async function discoverRelations() {
  const res = await fetch(`${URL_}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`Could not list tables: ${res.status} ${res.statusText}`);
  const spec = await res.json();
  const defs = spec.definitions ?? spec.components?.schemas ?? {};
  const rels = Object.entries(defs).map(([name, def]) => ({
    name,
    pk: Object.entries(def.properties ?? {})
      .filter(([, p]) => /Primary Key/i.test(p.description ?? ""))
      .map(([col]) => col),
  }));
  if (!rels.length) throw new Error("Table discovery returned nothing — refusing to write an empty backup.");
  return rels.sort((a, b) => a.name.localeCompare(b.name));
}

const PAGE = 1000; // PostgREST caps here regardless of what we ask for

// ONLY a genuinely absent relation may be skipped.
//
// This test used to be /does not exist|schema cache/ against the message, which
// ALSO matches "column <t>.id does not exist" — so every table lacking an `id`
// column was labelled "not in this project" and dropped from the backup. That
// hid 17 of CardOps' 61 relations, two of them holding live config rows, and
// the run still printed Done. Match the relation-missing codes, nothing looser.
const isMissingRelation = (e) =>
  e?.code === "42P01" || e?.code === "PGRST205" ||
  /Could not find the table/i.test(e?.message ?? "") ||
  /relation .* does not exist/i.test(e?.message ?? "");

/** Read a relation to completion. A short read is a FAILED read, never the end. */
async function dumpRelation({ name, pk }) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(name).select("*");
    for (const col of pk) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) {
      if (isMissingRelation(error)) return { rows: null, skipped: error.message };
      // Any other error is a failure. A relation we could not read is neither
      // an empty one nor an absent one, and must not be recorded as either.
      throw new Error(`${name}: ${error.message}${error.code ? ` [${error.code}]` : ""}`);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
    // With no ORDER BY, Postgres makes no promise that page 2 resumes where
    // page 1 stopped, so a multi-page unordered read can repeat and omit rows
    // at the same time. Refuse rather than write a plausible partial copy.
    if (!pk.length) {
      throw new Error(`${name}: over ${PAGE} rows and no primary key to page by — cannot copy this relation safely.`);
    }
  }
  return { rows, skipped: null };
}

async function backupTables() {
  fs.mkdirSync(path.join(outDir, "tables"), { recursive: true });
  const manifest = {};
  let total = 0;
  const RELATIONS = await discoverRelations();
  for (const rel of RELATIONS) {
    const res = await dumpRelation(rel);
    if (res.rows === null) {
      // Discovery found it and the read says it is gone. That is a real
      // anomaly, not routine, so it is loud and it is counted.
      manifest[rel.name] = { skipped: res.skipped };
      process.stdout.write(`  ${rel.name}: SKIPPED — ${res.skipped}\n`);
      continue;
    }
    fs.writeFileSync(path.join(outDir, "tables", `${rel.name}.json`), JSON.stringify(res.rows, null, 2));
    manifest[rel.name] = { rows: res.rows.length, pk: rel.pk };
    total += res.rows.length;
    process.stdout.write(`  ${rel.name}: ${res.rows.length}\n`);
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
if (tables) {
  const skipped = Object.entries(tables.manifest).filter(([, v]) => v.skipped).map(([t]) => t);
  console.log(`  ${tables.total} rows across ${Object.keys(tables.manifest).length} tables`);
  if (skipped.length) {
    console.log(`  ${skipped.length} SKIPPED — THIS BACKUP IS INCOMPLETE: ${skipped.join(", ")}`);
  }
}
if (photos) {
  console.log(`  ${photos.downloaded}/${photos.objects} objects (${(photos.bytes / 1048576).toFixed(1)} MB)`);
  if (photos.failed) console.log(`  ${photos.failed} FAILED — this backup is incomplete`);
}
console.log(`\n  ${outDir}`);
console.log(`  This is a LOCAL copy. It does not survive losing this machine.\n`);
void readline;
