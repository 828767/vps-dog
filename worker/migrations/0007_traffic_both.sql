-- Traffic quota metering.
--
--   traffic_both  1 (default) = the monthly quota counts downstream + upstream
--                 combined, which is how most providers meter a plan;
--                 0 = only outbound (upload) traffic counts toward the quota.
--
-- The month-to-date counters are accumulated at ingest from the agent's
-- cumulative `net_in`/`net_out` counters (positive deltas only, so a host
-- reboot resetting the counters cannot produce a negative or inflated month).
-- `traffic_month` holds the 'YYYY-MM' the counters belong to; the first report
-- of a new month resets them. This is what makes "remaining traffic" truthful
-- for a monthly quota — a since-boot cumulative counter would be wrong on any
-- server that has been up longer than its billing period.
ALTER TABLE nodes ADD COLUMN traffic_both INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nodes ADD COLUMN traffic_month TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN traffic_month_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN traffic_month_out INTEGER NOT NULL DEFAULT 0;
