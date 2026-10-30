-- ── uptime monitors ───────────────────────────────────────────────────────
-- Availability checks of *websites*, performed by the Worker itself (no agent
-- involved). One row per URL; the latest outcome is denormalised onto the row
-- so the dashboard stays a single query, exactly like `nodes.latest`.
CREATE TABLE IF NOT EXISTS uptime_monitors (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'GET',    -- 'GET' | 'HEAD'
  interval        INTEGER NOT NULL DEFAULT 300,   -- seconds between checks
  -- '2xx' (any code in the class) or an exact / comma-separated list ('200,204')
  expected_status TEXT NOT NULL DEFAULT '2xx',
  timeout_ms      INTEGER NOT NULL DEFAULT 10000,
  enabled         INTEGER NOT NULL DEFAULT 1,
  -- denormalised latest state
  last_checked    INTEGER NOT NULL DEFAULT 0,     -- 0 = never checked
  last_status     INTEGER NOT NULL DEFAULT 0,     -- 0 = no HTTP response
  last_latency    INTEGER NOT NULL DEFAULT 0,     -- ms
  last_ok         INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT NOT NULL DEFAULT '',
  -- notifier send-state: 1 = a "down" alert went out, recovery not sent yet
  notified_down   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uptime_monitors_due ON uptime_monitors(enabled, last_checked);

CREATE TABLE IF NOT EXISTS uptime_checks (
  monitor_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  status     INTEGER NOT NULL DEFAULT 0,          -- HTTP status, 0 = no response
  latency    INTEGER NOT NULL DEFAULT 0,          -- ms
  ok         INTEGER NOT NULL DEFAULT 0,
  error      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (monitor_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_uptime_checks_ts ON uptime_checks(ts);

-- ── settings ──────────────────────────────────────────────────────────────
-- Telegram alerts for uptime monitors; the node alerts keep their own toggles.
INSERT OR IGNORE INTO settings (key, value) VALUES ('tg_notify_uptime', 'true');
