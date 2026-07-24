-- Audit integrity (foundation-fixes item 4b).
--
-- The actor CHECK allowed only ('web','mcp','cron','assistant'), but the eBay
-- sync writes actor 'ebay-sync' per settled order and the account-deletion
-- endpoint writes 'ebay' — both inserts were silently rejected (23514 inside
-- swallowed promises), so the ONLY per-order settlement trail and the
-- compliance proof-of-receipt log never existed. Widen the constraint to the
-- actors the code actually writes; the code side now goes through
-- auditOrThrow, so any future constraint/actor mismatch fails loudly instead.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%actor%'
  loop
    execute format('alter table public.audit_log drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.audit_log add constraint audit_log_actor_check
  check (actor in ('web','mcp','cron','assistant','ebay-sync','ebay'));
