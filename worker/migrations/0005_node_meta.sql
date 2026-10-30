-- Operator-facing node metadata: plan price, monthly traffic quota and expiry
-- date. All three are pure display/management fields — nothing in the ingest
-- or sweep paths reads them.
--
--   price      free-form display text, e.g. "¥20/月" or "$5/mo" ('' = unset)
--   traffic_gb monthly quota in GB; 0 = unset/unlimited
--   expires_at ISO date 'YYYY-MM-DD'; '' = no expiry
ALTER TABLE nodes ADD COLUMN price TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN traffic_gb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
