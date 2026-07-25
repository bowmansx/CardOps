# Standalone Supabase bootstrap (the clean split)

Decided 2026-07-25: CardOps moves to its OWN Supabase project. The timing
argument flipped — zero sales, ~zero cards, 0 MB storage means there is no
data migration, only setup, and it is the cheapest it will ever be. The books
mirror between the apps flows through ZOHO (not shared tables), so it
survives untouched; the only direct cross-reader is the Master-Ops tax
advisor, re-pointed later via env vars in Master-Ops.

## Run order (Supabase SQL editor of the NEW project, in sequence)

1. `00_foundations.sql` — profiles/entities/audit_log/push_subscriptions +
   receipts bucket (the pieces Master-Ops-era migrations owned). The Card
   Operations entity is pinned to the app's hardcoded uuid.
2. `01_schema_part1.sql` → `01_schema_part2.sql` → `01_schema_part3.sql` —
   the full CardOps migration history, concatenated in order. Replays the
   pool era and then replaces it with purchase lots, exactly as production
   lived it. Expect "Success" for each.
3. Vercel env swap (card-ops project → Settings → Environment Variables):
   replace the values of `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` with the new
   project's (Supabase → Settings → API). Redeploy. **Beau does this — keys
   never transit chat.**
4. New project's auth config (Authentication → URL Configuration):
   Site URL = `https://card-ops-zeta.vercel.app`. Nothing else needed for
   magic links. **Google login requires configuring the Google provider on
   the new project** (same Google OAuth client, add the new
   `https://<newref>.supabase.co/auth/v1/callback` to the Google Cloud
   console's authorized redirect URIs) — or start magic-link-only and add
   Google after.
5. First login on card-ops-zeta (magic link needs `shouldCreateUser` relaxed
   or use Google; see note below), then `02_after_first_login.sql`.
6. Acceptance: paste `supabase/tests/money-core.test.sql` → 13 of 13 PASSED.

Note on first login: the login page sends magic links with
`shouldCreateUser: false` (defense in depth), so on an EMPTY auth the very
first sign-in must either use Google (once configured) or Beau's user is
created manually first (Supabase → Authentication → Users → "Add user" with
bowmansx@gmail.com — then the magic link works).

## After the split lands

- Old shared DB: the card tables there become dead weight; leave them until
  the Master-Ops card-code strip at cutover, then drop them from that side.
- Master-Ops tax advisor: point its card reads at the new project (two env
  vars + a second supabase client) whenever it next matters.
- Update CLAUDE.md's "Supabase is shared" section — after the swap it is no
  longer true.
- The cutover interlocks (eBay RuName, CRON_SECRET) are unrelated to which
  Supabase the app points at; that plan is unchanged.
