-- ══════════════════════════════════════════════════════════════════════════
-- STANDALONE BOOTSTRAP · STEP 2 — run AFTER Beau's FIRST login on the new
-- project (the login creates the auth.users row this promotes).
-- Then re-run the money-core harness (supabase/tests/money-core.test.sql)
-- and expect 13 of 13 PASSED — that's the split's acceptance test.
-- ══════════════════════════════════════════════════════════════════════════

insert into public.profiles (id, role, display_name)
select u.id, 'owner', 'Beau'
from auth.users u
where lower(u.email) = 'bowmansx@gmail.com'
on conflict (id) do update set role = 'owner';

-- Sanity: should return exactly one row — bowmansx@gmail.com · owner.
select u.email, p.role
from public.profiles p join auth.users u on u.id = p.id;
