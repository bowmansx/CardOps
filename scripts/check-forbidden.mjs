// Grep gates for bug classes tsc and eslint cannot see (prevention rules 1/5).
// Runs in `npm run check`; exits 1 with the offending lines on any hit.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");

const RULES = [
  {
    name: "fire-and-forget write (swallowed supabase promise)",
    why: "prevention rule 1: every write's { error } is checked and surfaced",
    re: /\.then\(\(\)\s*=>\s*\{\}\s*,\s*\(\)\s*=>\s*\{\}\)/,
  },
  {
    name: "raw audit_log insert",
    why: "audit writes go through auditOrThrow (src/lib/audit.ts) only",
    re: /from\("audit_log"\)\s*\.\s*insert/,
    allow: (file) => file.replace(/\\/g, "/").endsWith("src/lib/audit.ts"),
  },
  {
    name: "resurrected global pool",
    why: "card_pool/use_pool_basis are gone — basis is purchase lots or individual (CLAUDE.md)",
    re: /use_pool_basis|from\("card_pool"\)/,
  },
];

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
    const text = readFileSync(p, "utf8");
    const lines = text.split("\n");
    for (const rule of RULES) {
      if (rule.allow?.(p)) continue;
      lines.forEach((line, i) => {
        if (rule.re.test(line)) {
          offenders.push(`${relative(ROOT, p)}:${i + 1}  [${rule.name}]\n    ${line.trim()}\n    → ${rule.why}`);
        }
      });
    }
  }
}
walk(SRC);

if (offenders.length) {
  console.error(`check-forbidden: ${offenders.length} violation(s)\n`);
  for (const o of offenders) console.error(o + "\n");
  process.exit(1);
}
console.log("check-forbidden: clean");
