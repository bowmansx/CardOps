-- ══════════════════════════════════════════════════════════════════════════
-- CARD-PHOTOS BUCKET LIMITS (Beau, 2026-07-25)
--
-- Photos now go straight from the BROWSER to storage rather than through a
-- server action (which is what stopped booking a card from hanging on
-- "Saving…" — see next-steps step 0). That removed the accidental ceiling the
-- server-action body limit used to provide: until now a signed-in card user
-- could PUT an object of any size and any content type into this bucket.
--
-- Storage is a metered, billable resource. An unbounded write path is how one
-- careless upload becomes someone else's bill.
--
-- 25 MB is deliberately generous: the Archive quality preset caps the long
-- edge at 4000px, which lands around 3 MB, and a 12-shot grading template
-- keeps every frame separate rather than in one giant file. Nothing the app
-- produces should come close.
-- ══════════════════════════════════════════════════════════════════════════

update storage.buckets
   set file_size_limit = 26214400,   -- 25 MiB per object
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 where id = 'card-photos';

-- ── finding orphans ───────────────────────────────────────────────────────
-- An object can now exist with no card_photos row: the browser's upload
-- succeeded and the recording call failed. Those bytes are invisible to the
-- storage meter (user_storage_usage sums card_photos.bytes) and to every
-- screen. The app reports the failure and offers a retry, but nothing sweeps
-- what was already abandoned, so here is the query that finds them.
--
-- Owner-only: it reads across tenants by design, which is why it is not
-- exposed to `authenticated`.
create or replace function public.card_photo_orphans()
returns table (name text, owner_segment text, bytes bigint, created_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.name,
         split_part(o.name, '/', 1) as owner_segment,
         coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         o.created_at
    from storage.objects o
   where o.bucket_id = 'card-photos'
     and not exists (select 1 from public.card_photos p where p.path = o.name)
     -- Give an in-flight upload time to be recorded before calling it orphaned.
     and o.created_at < now() - interval '1 hour'
   order by o.created_at desc
$$;
revoke all on function public.card_photo_orphans() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.card_photo_orphans() to service_role';
  end if;
end $$;
