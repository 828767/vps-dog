-- Per-node notification toggle + country geolocation.
--
--   notify  0 = this node never triggers Telegram offline/recovery alerts
--           (the global tg_* settings still apply); 1 = alert like normal.
--   country ISO-3166 alpha-2 code of the node's source IP, taken from
--           Cloudflare's free `request.cf.country` on every report
--           (read-only metadata for the dashboard's flag display).
ALTER TABLE nodes ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nodes ADD COLUMN country TEXT NOT NULL DEFAULT '';
