-- Telegram notifications: per-node notification state + settings defaults.
--
-- `notified_offline` is deliberately NOT a copy of the online status (online is
-- always derived from `last_seen` at read time). It records what the notifier
-- last told the admin about this node, so the cron scanner can send exactly one
-- "offline" message per outage and one "back online" message per recovery:
--
--   offline pending  = last_seen > 0 AND offline AND notified_offline = 0
--   recovery pending = online AND notified_offline = 1
--
-- A node that has never reported (last_seen = 0) stays silent.
ALTER TABLE nodes ADD COLUMN notified_offline INTEGER NOT NULL DEFAULT 0;

-- Defaults for the new settings keys. `getSettings()` merges these over the
-- stored rows anyway; the rows are seeded so a freshly migrated database is
-- fully configured, exactly like 0001.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('tg_bot_token', ''),
  ('tg_chat_id', ''),
  ('tg_notify_offline', 'true'),
  ('tg_notify_online', 'false');
