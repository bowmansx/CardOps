#!/usr/bin/env node
// KEEP THE SUPABASE PROJECT AWAKE (2026-10-28)
//
// The CardOps project is on the FREE plan, which pauses a project after about
// seven idle days — and "idle" is the project's permanent condition: no cron
// runs anywhere (Master-Ops shed its card crons on 2026-07-25, and CardOps's
// own six return 401 on purpose until they are hardened), and no cards have
// been entered. It has paused at least three times (2026-08-18, 2026-09-05,
// and a spell still down on 08-29). A paused project stops resolving in DNS, so
// the site loads and nothing works.
//
// Beau chose the free route over the Pro plan, so this is the activity. One
// cheap read, often enough that a missed run does not matter.
//
// RUNS OFF THE LAPTOP, which is the whole point — the machine goes 7-9 days
// without being opened, so a local scheduled task cannot be the keep-alive.
// GitHub Actions drives it; see `.github/workflows/keepalive.yml`.
//
// NEEDS NO SECRETS. The anon key is public by design — every visitor's browser
// holds it — so with none in the environment this lifts it out of the deployed
// client bundle. Nothing to rotate, nothing to leak.
//
// READ-ONLY. One row, one column, discarded.
//
//   node scripts/keepalive.mjs

const PROD = "https://card-ops-zeta.vercel.app";
const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://zgkydwvmdnnrxcacegth.supabase.co";

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

const key = await publicKey();
if (!key) {
  console.error("FAIL: no anon key — set NEXT_PUBLIC_SUPABASE_ANON_KEY, or " + PROD + " is unreachable.");
  process.exit(1);
}

// `card_identities` is the catalogue, not tenant data, and it is the smallest
// honest read available: RLS gives an empty array to an anon caller, which is
// a successful request either way. A 2xx or an RLS refusal both prove the
// database answered; that is all "awake" means.
const url = `${PROJECT_URL}/rest/v1/card_identities?select=id&limit=1`;
const started = Date.now();
let res;
try {
  res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
} catch (e) {
  // THE ALARM. A paused project does not refuse the connection, it stops
  // existing in DNS — so this is the branch that actually fires when the thing
  // this script exists to prevent has already happened.
  console.error(`FAIL: ${PROJECT_URL} is unreachable — ${e instanceof Error ? e.message : e}`);
  console.error("Most likely the project is PAUSED. Restore it at");
  console.error("https://supabase.com/dashboard/project/zgkydwvmdnnrxcacegth");
  process.exit(1);
}

const ms = Date.now() - started;
// 401/403 is RLS doing its job on an anon caller: the request reached Postgres.
if (res.ok || res.status === 401 || res.status === 403) {
  console.log(`awake — ${PROJECT_URL} answered ${res.status} in ${ms}ms`);
  process.exit(0);
}
console.error(`FAIL: unexpected ${res.status} from ${PROJECT_URL} in ${ms}ms`);
console.error((await res.text().catch(() => "")).slice(0, 300));
process.exit(1);
