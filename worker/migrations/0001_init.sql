PRAGMA foreign_keys = ON;

-- ── servers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,          -- uuid v4
  name        TEXT NOT NULL,             -- display name (unique, user-set)
  token_hash  TEXT NOT NULL,             -- sha256 hex of the agent token
  token_hint  TEXT NOT NULL DEFAULT '',  -- first 8 chars, for UI display only
  group_name  TEXT NOT NULL DEFAULT 'default',
  region      TEXT NOT NULL DEFAULT '',  -- free text, e.g. "HK", "Frankfurt"
  tags        TEXT NOT NULL DEFAULT '[]',-- JSON array of strings
  hidden      INTEGER NOT NULL DEFAULT 0,-- 0|1
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- denormalised latest state (keeps the dashboard to a single query)
  last_seen   INTEGER NOT NULL DEFAULT 0,
  latest      TEXT                       -- JSON MetricSample | NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_sort ON nodes(sort_order, created_at);

-- ── metric time series ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  node_id    TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  cpu        REAL    NOT NULL DEFAULT 0,
  mem_used   INTEGER NOT NULL DEFAULT 0,
  mem_total  INTEGER NOT NULL DEFAULT 0,
  swap_used  INTEGER NOT NULL DEFAULT 0,
  swap_total INTEGER NOT NULL DEFAULT 0,
  disk_used  INTEGER NOT NULL DEFAULT 0,
  disk_total INTEGER NOT NULL DEFAULT 0,
  net_in     INTEGER NOT NULL DEFAULT 0,   -- cumulative bytes since boot
  net_out    INTEGER NOT NULL DEFAULT 0,
  rx_rate    REAL    NOT NULL DEFAULT 0,   -- bytes/sec, computed by agent
  tx_rate    REAL    NOT NULL DEFAULT 0,
  tcp        INTEGER NOT NULL DEFAULT 0,
  udp        INTEGER NOT NULL DEFAULT 0,
  process    INTEGER NOT NULL DEFAULT 0,
  uptime     INTEGER NOT NULL DEFAULT 0,   -- seconds
  load1      REAL    NOT NULL DEFAULT 0,
  load5      REAL    NOT NULL DEFAULT 0,
  load15     REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);

-- ── latency probes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ping_tasks (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,              -- 'icmp' | 'tcp' | 'http'
  target     TEXT NOT NULL,              -- host / host:port / url
  interval   INTEGER NOT NULL DEFAULT 60,-- seconds
  enabled    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ping_tasks_node ON ping_tasks(node_id);

CREATE TABLE IF NOT EXISTS ping_records (
  task_id  TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  value    REAL NOT NULL DEFAULT 0,      -- latency ms; -1 when failed
  ok       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_ping_records_node ON ping_records(node_id, ts);

-- ── auth ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- pbkdf2: see §5
  role          TEXT NOT NULL DEFAULT 'admin',  -- 'admin' | 'viewer'
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- random 32-byte hex
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- ── misc ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  user    TEXT NOT NULL DEFAULT '',
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT '',
  ip      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);

-- ── settings defaults (§2.1) ──────────────────────────────────────────────
-- Keeps a freshly migrated database fully configured.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name', 'VPS-DOG'),
  ('site_description', ''),
  ('report_interval', '30'),
  ('offline_after', '90'),
  ('retention_days', '30'),
  ('ping_retention_days', '7'),
  ('theme', 'auto'),
  ('custom_head', ''),
  -- Referenced by §4.1 (agent auto-registration). Default off.
  ('allow_auto_register', 'false');
