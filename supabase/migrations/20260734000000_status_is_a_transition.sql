-- Status is a transition, not a field (foundation-fixes item 2).
--
-- The 2026-07-25 review's one CRITICAL: generic update paths accepted any
-- status, so an edit could pull a sold card back to 'booked' with no reversal
-- (basis stays drawn, sale row stays, card sellable AGAIN), and cards could be
-- created 'sold' with no sale booked. guard_card_sale only watched transitions
-- TO 'sold' and exempted the owner entirely.
--
-- New rule, enforced at the database so PostgREST can't route around it:
-- crossing the 'sold' boundary in EITHER direction — and any edit of
-- basis_drawn / sold_at — happens only inside card_sell / card_unsell (the
-- cardops.in_sell handshake). No owner exemption: the owner corrects mistakes
-- through card_unsell like everyone else. service_role is unaffected (crons
-- settle through the RPCs anyway). Non-sold status moves (booked/listed/
-- graded_out/archived) stay free.
--
-- Idempotent; safe to re-run.

create or replace function public.guard_card_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status
        and (new.status = 'sold' or old.status = 'sold'))
     or new.basis_drawn is distinct from old.basis_drawn
     or new.sold_at is distinct from old.sold_at then
    if coalesce(auth.role(), '') = 'authenticated'
       and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
      raise exception 'sold is a transition: use card_sell / card_unsell';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_sale_guard on public.cards;
create trigger cards_sale_guard before update on public.cards
  for each row execute function public.guard_card_sale();

-- Cards cannot be BORN sold: an insert with status='sold' has no sale row, no
-- basis draw, no P/L — it is a lie the books would repeat. Applies to every
-- authenticated insert (form, CSV import, raw PostgREST).
create or replace function public.guard_card_birth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sold'
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
    raise exception 'cards cannot be created sold — import as booked and enter the sale explicitly';
  end if;
  return new;
end $$;
drop trigger if exists cards_birth_guard on public.cards;
create trigger cards_birth_guard before insert on public.cards
  for each row execute function public.guard_card_birth();
