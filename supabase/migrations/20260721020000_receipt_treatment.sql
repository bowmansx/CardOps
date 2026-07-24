-- Receipt tax treatment (Beau, 2026-07-21). A cost receipt/transaction is booked
-- under an entity AND a tax treatment (investment / dealer / hobby). For an
-- advance, the RECEIVING entity's treatment (the second transaction bar) is
-- captured separately. treatment = how the acquiring side holds these cards.
-- Additive + idempotent.
alter table public.card_receipts add column if not exists treatment text not null default 'dealer';
alter table public.card_receipts add column if not exists advance_treatment text;

do $$ begin
  if not exists (select 1 from information_schema.constraint_column_usage
                 where table_name='card_receipts' and constraint_name='card_receipts_treatment_chk') then
    alter table public.card_receipts add constraint card_receipts_treatment_chk
      check (treatment in ('dealer', 'investment', 'hobby'));
  end if;
  if not exists (select 1 from information_schema.constraint_column_usage
                 where table_name='card_receipts' and constraint_name='card_receipts_advance_treatment_chk') then
    alter table public.card_receipts add constraint card_receipts_advance_treatment_chk
      check (advance_treatment is null or advance_treatment in ('dealer', 'investment', 'hobby'));
  end if;
end $$;
