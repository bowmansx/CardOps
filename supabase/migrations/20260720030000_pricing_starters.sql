-- Pricing builder starters (Beau, 2026-07-18). Additive + idempotent — five
-- good default calculation formats authored in the v1 pipeline grammar, each
-- tagged with the card types it suits. The six legacy seeds are untouched.
insert into public.card_pricing_strategies (key, label, target_rule, params) values
(
  'c_recent_median', 'Recent Median', 'custom',
  '{"v":1,"pipeline":{"window_days":90,"last_n":10,"min_comps":3,"guards":{"iqr_k":1.5},"aggregate":{"fn":"median"}},"meta":{"tags":["high volume","stable market","outlier-protected"],"desc":"Median of the last 10 sales within 90 days, behind a classic outlier fence."}}'::jsonb
),
(
  'c_patient_vintage', 'Patient Vintage', 'custom',
  '{"v":1,"pipeline":{"window_days":730,"min_comps":2,"guards":{"drop_top_pct":0.1,"drop_bottom_pct":0.1},"aggregate":{"fn":"trimmed_mean","trim_pct":0.1}},"meta":{"tags":["vintage","low volume","low population"],"desc":"Two-year window with trimmed averaging — patient valuation for cards that rarely trade."}}'::jsonb
),
(
  'c_fast_flip', 'Fast Flip', 'custom',
  '{"v":1,"pipeline":{"window_days":60,"last_n":5,"min_comps":2,"guards":{"iqr_k":1.5},"aggregate":{"fn":"min"},"adjust":{"multiplier":0.97,"round_99":true}},"meta":{"tags":["fast flip","high volume"],"desc":"Prices just under the lowest recent sale to move inventory quickly."}}'::jsonb
),
(
  'c_hot_streak', 'Hot Streak', 'custom',
  '{"v":1,"pipeline":{"window_days":30,"min_comps":3,"guards":{"drop_top_pct":0.1},"aggregate":{"fn":"wavg_recency","half_life_days":14},"adjust":{"multiplier":1.03}},"meta":{"tags":["hot player","high volume","modern"],"desc":"Recency-weighted average with a 2-week half-life — rides a heater without chasing one spike."}}'::jsonb
),
(
  'c_numbered_premium', 'Numbered Premium', 'custom',
  '{"v":1,"pipeline":{"window_days":365,"min_comps":2,"guards":{"iqr_k":2},"aggregate":{"fn":"median"},"adjust":{"multiplier":1.08}},"meta":{"tags":["numbered","low population","premium"],"desc":"Year-long median with a scarcity premium for serial-numbered cards."}}'::jsonb
)
on conflict (key) do nothing;
