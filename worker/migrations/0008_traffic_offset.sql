-- Manual correction for "traffic used this month".
--
-- The dashboard's remaining-traffic cell is `quota - used`, and `used` is
-- accumulated automatically from the agent's counters. That number is wrong
-- whenever the agent started reporting mid-month, when the provider meters
-- differently, or after a plan migration — so an operator must be able to
-- correct it.
--
-- Stored as a signed OFFSET rather than an absolute replacement:
--
--   used = auto_used + (offset_month = current month ? offset : 0)
--
-- Writing an absolute value would be overwritten by the next report (the
-- ingest path adds its delta on top of whatever is stored). The offset keeps
-- the correction stable while reports continue to accumulate, and tying it to
-- `offset_month` makes it expire on its own when the billing month rolls over.
ALTER TABLE nodes ADD COLUMN traffic_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN traffic_offset_month TEXT NOT NULL DEFAULT '';
