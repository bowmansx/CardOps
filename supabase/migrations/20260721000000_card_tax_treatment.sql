-- Per-card tax classification (Beau, 2026-07-21). How a card is booked depends on
-- whether it's held as dealer inventory, a capital investment, or a hobby item —
-- each posts to the books differently. Per-card (versatile: a mixed collection can
-- hold some of each). Defaults to 'dealer' (matches the current journal). Additive.
alter table public.cards
  add column if not exists tax_treatment text not null default 'dealer';

do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'cards' and constraint_name = 'cards_tax_treatment_chk'
  ) then
    alter table public.cards
      add constraint cards_tax_treatment_chk check (tax_treatment in ('dealer', 'investment', 'hobby'));
  end if;
end $$;
