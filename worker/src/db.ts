/**
 * D1 access layer: typed helpers, row mappers and the downsampling query.
 */
import {
  SETTINGS_DEFAULTS,
  type AdminNode,
  type AuditLogRow,
  type MetricPoint,
  type MetricSample,
  type MetricSeries,
  type NodeDetail,
  type NodeHostInfo,
  type NodeSummary,
  type PingSeriesPoint,
  type PingTaskSummary,
  type PingTaskWithSeries,
  type PublicStatus,
  type Settings,
  type SettingsKey,
  type UptimeCheckPoint,
  type UptimeMonitorSummary,
} from './types';
import {
  UPTIME_DEFAULT_INTERVAL,
  UPTIME_DEFAULT_TIMEOUT,
  UPTIME_MAX_INTERVAL,
  UPTIME_MAX_TIMEOUT,
  UPTIME_MIN_INTERVAL,
  UPTIME_MIN_TIMEOUT,
  defaultMonitorName,
  normalizeExpectedStatus,
  normalizeMonitorUrl,
} from './uptime';
import {
  bool,
  clampInt,
  nowSec,
  num,
  parseJsonColumn,
  parseTags,
  str,
  tagsToJson,
  uuid,
} from './util';

// ── raw row shapes ──────────────────────────────────────────────────────────

export interface NodeRow {
  id: string;
  name: string;
  token_hash: string;
  token_hint: string;
  group_name: string;
  region: string;
  tags: string;
  hidden: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  last_seen: number;
  latest: string | null;
  /** Source address of the last report; `''` until the node first checks in. */
  ip: string;
  /** Notifier send-state: 1 = an offline alert went out, recovery not yet sent. */
  notified_offline: number;
  /** JSON NodeHostInfo | NULL — CPU model / core count from the agent. */
  host_info: string | null;
  /** Operator-set plan metadata (§2): display text, GB quota, ISO date. */
  price: string;
  traffic_gb: number;
  /** 1 = quota counts down+up; 0 = outbound only. */
  traffic_both: number;
  /** 'YYYY-MM' the month counters belong to; '' = never accumulated. */
  traffic_month: string;
  /** Bytes moved since the start of `traffic_month`. */
  traffic_month_in: number;
  traffic_month_out: number;
  /** Signed manual correction to the metered usage (bytes). */
  traffic_offset: number;
  /** 'YYYY-MM' the correction was made in; '' = never. Expires on rollover. */
  traffic_offset_month: string;
  expires_at: string;
  /** 0 = excluded from Telegram offline/recovery alerts. */
  notify: number;
  /** ISO country code of the last report's source IP; '' = unknown. */
  country: string;
}

export interface PingTaskRow {
  id: string;
  node_id: string;
  name: string;
  type: string;
  target: string;
  interval: number;
  enabled: number;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface UptimeMonitorRow {
  id: string;
  name: string;
  url: string;
  method: string;
  interval: number;
  expected_status: string;
  timeout_ms: number;
  enabled: number;
  last_checked: number;
  last_status: number;
  last_latency: number;
  last_ok: number;
  last_error: string;
  notified_down: number;
  created_at: number;
  updated_at: number;
}

export interface MetricRow {
  node_id: string;
  ts: number;
  cpu: number;
  mem_used: number;
  mem_total: number;
  swap_used: number;
  swap_total: number;
  disk_used: number;
  disk_total: number;
  net_in: number;
  net_out: number;
  rx_rate: number;
  tx_rate: number;
  tcp: number;
  udp: number;
  process: number;
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
}

// ── generic helpers ─────────────────────────────────────────────────────────

async function first<T>(stmt: D1PreparedStatement): Promise<T | null> {
  const row = await stmt.first<T>();
  return row ?? null;
}

async function all<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const res = await stmt.all<T>();
  return (res.results ?? []) as T[];
}

/** `meta.changes` for a write, 0 when unavailable. */
function changes(res: D1Result): number {
  const meta = res.meta as { changes?: number } | undefined;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
}

// ── settings ────────────────────────────────────────────────────────────────

/** Every settings key, in the order of the §2.1 table. */
export const SETTINGS_KEYS: SettingsKey[] = [
  'site_name',
  'site_description',
  'report_interval',
  'offline_after',
  'retention_days',
  'ping_retention_days',
  'theme',
  'custom_head',
  'allow_auto_register',
  'tg_bot_token',
  'tg_chat_id',
  'tg_notify_offline',
  'tg_notify_online',
  'tg_notify_uptime',
];

/**
 * Read all settings, merging stored rows over the §2.1 defaults.
 * Unknown keys in the table are ignored (§2.1).
 */
export async function getSettings(db: D1Database): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(db.prepare('SELECT key, value FROM settings'));
  const out: Settings = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    if (!(SETTINGS_KEYS as string[]).includes(row.key)) continue;
    const key = row.key as SettingsKey;
    const raw = row.value;
    switch (key) {
      case 'report_interval':
      case 'offline_after':
      case 'retention_days':
      case 'ping_retention_days':
        out[key] = clampInt(raw, 0, 100000, SETTINGS_DEFAULTS[key]);
        break;
      case 'allow_auto_register':
      case 'tg_notify_offline':
      case 'tg_notify_online':
      case 'tg_notify_uptime':
        out[key] = bool(raw, SETTINGS_DEFAULTS[key]);
        break;
      case 'tg_bot_token':
      case 'tg_chat_id':
        out[key] = str(raw, SETTINGS_DEFAULTS[key]).trim();
        break;
      case 'theme': {
        const t = str(raw, SETTINGS_DEFAULTS.theme);
        out.theme = t === 'light' || t === 'dark' || t === 'auto' ? t : SETTINGS_DEFAULTS.theme;
        break;
      }
      default:
        out[key] = str(raw, SETTINGS_DEFAULTS[key]);
    }
  }
  return out;
}

/** Partial settings update. Unknown keys are ignored. Returns the merged result. */
export async function putSettings(
  db: D1Database,
  patch: Record<string, unknown>,
): Promise<Settings> {
  const statements: D1PreparedStatement[] = [];
  for (const key of SETTINGS_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    let encoded: string;
    switch (key) {
      case 'report_interval':
      case 'offline_after':
      case 'retention_days':
      case 'ping_retention_days':
        encoded = String(clampInt(value, 0, 100000, SETTINGS_DEFAULTS[key]));
        break;
      case 'allow_auto_register':
        encoded = bool(value, SETTINGS_DEFAULTS[key]) ? 'true' : 'false';
        break;
      case 'tg_notify_offline':
      case 'tg_notify_online':
      case 'tg_notify_uptime':
        encoded = bool(value, SETTINGS_DEFAULTS[key]) ? 'true' : 'false';
        break;
      case 'tg_bot_token':
      case 'tg_chat_id':
        encoded = str(value, SETTINGS_DEFAULTS[key]).trim();
        break;
      case 'theme': {
        const t = str(value, SETTINGS_DEFAULTS.theme);
        encoded = t === 'light' || t === 'dark' || t === 'auto' ? t : SETTINGS_DEFAULTS.theme;
        break;
      }
      default:
        encoded = str(value, SETTINGS_DEFAULTS[key]);
    }
    statements.push(
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, encoded),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return getSettings(db);
}

// ── mappers ─────────────────────────────────────────────────────────────────

export function percent(used: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const p = (used / total) * 100;
  return Number.isFinite(p) ? Math.round(p * 100) / 100 : 0;
}

/** Coerce an arbitrary object into a full MetricSample (missing → 0). */
export function coerceSample(input: Record<string, unknown>): MetricSample {  return {
    cpu: num(input.cpu),
    mem_used: Math.trunc(num(input.mem_used)),
    mem_total: Math.trunc(num(input.mem_total)),
    swap_used: Math.trunc(num(input.swap_used)),
    swap_total: Math.trunc(num(input.swap_total)),
    disk_used: Math.trunc(num(input.disk_used)),
    disk_total: Math.trunc(num(input.disk_total)),
    net_in: Math.trunc(num(input.net_in)),
    net_out: Math.trunc(num(input.net_out)),
    rx_rate: num(input.rx_rate),
    tx_rate: num(input.tx_rate),
    tcp: Math.trunc(num(input.tcp)),
    udp: Math.trunc(num(input.udp)),
    process: Math.trunc(num(input.process)),
    uptime: Math.trunc(num(input.uptime)),
    load1: num(input.load1),
    load5: num(input.load5),
    load15: num(input.load15),
  };
}

function sampleFromRow(row: MetricRow): MetricSample {
  return {
    cpu: num(row.cpu),
    mem_used: Math.trunc(num(row.mem_used)),
    mem_total: Math.trunc(num(row.mem_total)),
    swap_used: Math.trunc(num(row.swap_used)),
    swap_total: Math.trunc(num(row.swap_total)),
    disk_used: Math.trunc(num(row.disk_used)),
    disk_total: Math.trunc(num(row.disk_total)),
    net_in: Math.trunc(num(row.net_in)),
    net_out: Math.trunc(num(row.net_out)),
    rx_rate: num(row.rx_rate),
    tx_rate: num(row.tx_rate),
    tcp: Math.trunc(num(row.tcp)),
    udp: Math.trunc(num(row.udp)),
    process: Math.trunc(num(row.process)),
    uptime: Math.trunc(num(row.uptime)),
    load1: num(row.load1),
    load5: num(row.load5),
    load15: num(row.load15),
  };
}

/**
 * Normalise a stored `host_info` JSON blob. Anything malformed, empty or of
 * the wrong shape becomes `null` so the SPA can treat the field as absent.
 */
export function coerceHostInfo(input: unknown): NodeHostInfo | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const model = str(raw.cpu_model).trim().slice(0, 160);
  const cores = Math.trunc(num(raw.cpu_cores));
  if (model === '' || cores <= 0) return null;
  return { cpu_model: model, cpu_cores: Math.min(4096, cores) };
}

/** Plan price: trimmed display text, bounded so a row cannot grow unbounded. */
export function coercePrice(value: unknown): string {
  return str(value).trim().slice(0, 60);
}

/**
 * Expiry date: accepts 'YYYY-MM-DD' (also the JS `Date.toISOString` prefix
 * form) or '' to clear. Anything else becomes '' — this field is display
 * metadata, so a typo must not 400 a bulk PATCH.
 */
export function coerceExpiresAt(value: unknown): string {
  const raw = str(value).trim();
  if (raw === '') return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (m === null) return '';
  const parsed = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return m[1];
}

/** 'YYYY-MM' (UTC) for a Unix-seconds timestamp. */
export function monthKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 7);
}

export interface MonthTraffic {
  month: string;
  in: number;
  out: number;
}

/**
 * Fold one report's cumulative counters into the month-to-date totals.
 *
 * The agent reports `net_in`/`net_out` since boot, so the month total is built
 * from the positive delta against the previous sample: a host reboot resets
 * those counters to 0, and a naive difference would go negative or wildly
 * overcount. The first report after a gap (or ever) contributes nothing —
 * there is no baseline to diff against. Crossing into a new month resets the
 * counters, which is what makes a monthly quota meaningful on a server that
 * has been up longer than its billing period.
 */
export function accumulateMonthTraffic(
  prev: MetricSample | null,
  next: MetricSample,
  row: Pick<NodeRow, 'traffic_month' | 'traffic_month_in' | 'traffic_month_out' | 'last_seen'>,
  now: number,
): MonthTraffic {
  const month = monthKey(now);
  const sameMonth = str(row.traffic_month) === month;
  const deltaIn = prev !== null ? Math.max(0, next.net_in - prev.net_in) : 0;
  const deltaOut = prev !== null ? Math.max(0, next.net_out - prev.net_out) : 0;
  if (!sameMonth) {
    // A new month (or the first report since this feature shipped). Seed with
    // the agent's since-boot counters *only* when this is the node's very
    // first report ever (`last_seen = 0`) — there the counters cover exactly
    // the node's own lifetime. On an established node they span an unknown
    // window, so the month starts at zero and only this report's delta counts
    // (the window it covers straddles the boundary; reports are seconds apart,
    // so attributing it to the new month loses nothing).
    const firstEver = num(row.last_seen) === 0;
    return {
      month,
      in: firstEver ? Math.trunc(Math.max(0, next.net_in)) : Math.trunc(deltaIn),
      out: firstEver ? Math.trunc(Math.max(0, next.net_out)) : Math.trunc(deltaOut),
    };
  }
  const baseIn = num(row.traffic_month_in);
  const baseOut = num(row.traffic_month_out);
  return { month, in: Math.trunc(baseIn + deltaIn), out: Math.trunc(baseOut + deltaOut) };
}

/**
 * Usage this month as the quota meters it, ignoring any manual correction:
 * both directions when `traffic_both`, outbound only otherwise.
 *
 * Counters stamped with a past month read as 0: they describe a period that
 * has already been billed, and the next report resets them anyway — showing
 * last month's total against this month's quota would be plainly wrong.
 */
export function meteredMonthBytes(
  row: Pick<NodeRow, 'traffic_both' | 'traffic_month' | 'traffic_month_in' | 'traffic_month_out'>,
  now: number,
): number {
  if (str(row.traffic_month) !== monthKey(now)) return 0;
  const inbound = num(row.traffic_month_in);
  const outbound = num(row.traffic_month_out);
  return Math.trunc(num(row.traffic_both, 1) !== 0 ? inbound + outbound : outbound);
}

/**
 * The number the dashboard shows as "used this month": automatic metering plus
 * the operator's correction, when that correction belongs to the current month.
 *
 * The correction is stored as an offset (see migration 0008) so it survives the
 * reports that keep accumulating on top of it, and so it expires on its own
 * when the billing month rolls over.
 */
export function monthUsedBytes(
  row: Pick<NodeRow, 'traffic_both' | 'traffic_month' | 'traffic_month_in' | 'traffic_month_out' | 'traffic_offset' | 'traffic_offset_month'>,
  now: number,
): number {
  const metered = meteredMonthBytes(row, now);
  const offset = str(row.traffic_offset_month) === monthKey(now) ? num(row.traffic_offset) : 0;
  return Math.max(0, Math.trunc(metered + offset));
}

/** `online` is always derived from `last_seen` — it is never stored (§7). */
export function isOnline(row: Pick<NodeRow, 'last_seen'>, offlineAfter: number, now: number): boolean {
  return num(row.last_seen) > 0 && num(row.last_seen) >= now - offlineAfter;
}

export function mapNodeSummary(row: NodeRow, offlineAfter: number, now: number): NodeSummary {
  const metrics = parseJsonColumn<MetricSample | null>(row.latest, null);
  const sample = metrics ? coerceSample(metrics as unknown as Record<string, unknown>) : null;
  return {
    id: str(row.id),
    name: str(row.name),
    group: str(row.group_name, 'default'),
    region: str(row.region),
    tags: parseTags(row.tags),
    ip: str(row.ip),
    hidden: bool(row.hidden),
    online: isOnline(row, offlineAfter, now),
    last_seen: num(row.last_seen),
    uptime: sample ? sample.uptime : 0,
    created_at: num(row.created_at),
    metrics: sample,
    host: coerceHostInfo(parseJsonColumn<unknown>(row.host_info ?? null, null)),
    price: str(row.price),
    traffic_gb: Math.trunc(num(row.traffic_gb)),
    traffic_both: num(row.traffic_both, 1) !== 0,
    traffic_month_in: Math.trunc(num(row.traffic_month_in)),
    traffic_month_out: Math.trunc(num(row.traffic_month_out)),
    traffic_used: monthUsedBytes(row, now),
    traffic_corrected: str(row.traffic_offset_month) === monthKey(now) && num(row.traffic_offset) !== 0,
    expires_at: str(row.expires_at),
    notify: num(row.notify, 1) !== 0,
    country: str(row.country),
    cpu: sample ? sample.cpu : 0,
    mem_percent: sample ? percent(sample.mem_used, sample.mem_total) : 0,
    disk_percent: sample ? percent(sample.disk_used, sample.disk_total) : 0,
    load1: sample ? sample.load1 : 0,
  };
}

export function mapAdminNode(row: NodeRow, offlineAfter: number, now: number): AdminNode {
  return {
    ...mapNodeSummary(row, offlineAfter, now),
    token_hint: str(row.token_hint),
    sort_order: num(row.sort_order),
  };
}

// ── nodes ───────────────────────────────────────────────────────────────────

export async function listNodes(db: D1Database, includeHidden = false): Promise<NodeRow[]> {
  const sql = includeHidden
    ? 'SELECT * FROM nodes ORDER BY sort_order ASC, created_at ASC'
    : 'SELECT * FROM nodes WHERE hidden = 0 ORDER BY sort_order ASC, created_at ASC';
  return all<NodeRow>(db.prepare(sql));
}

export async function getNode(db: D1Database, id: string): Promise<NodeRow | null> {
  return first<NodeRow>(db.prepare('SELECT * FROM nodes WHERE id = ?').bind(id));
}

export async function getNodeByName(db: D1Database, name: string): Promise<NodeRow | null> {
  return first<NodeRow>(db.prepare('SELECT * FROM nodes WHERE name = ?').bind(name));
}

export async function getNodeByTokenHash(db: D1Database, tokenHash: string): Promise<NodeRow | null> {
  return first<NodeRow>(db.prepare('SELECT * FROM nodes WHERE token_hash = ?').bind(tokenHash));
}

export interface CreateNodeInput {
  name: string;
  tokenHash: string;
  tokenHint: string;
  group?: string;
  region?: string;
  tags?: string[];
  hidden?: boolean;
  sortOrder?: number;
  price?: string;
  trafficGb?: number;
  trafficBoth?: boolean;
  expiresAt?: string;
  notify?: boolean;
}

export async function createNode(db: D1Database, input: CreateNodeInput): Promise<NodeRow> {
  const id = uuid();
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO nodes
         (id, name, token_hash, token_hint, group_name, region, tags, hidden, sort_order,
          created_at, updated_at, last_seen, latest, price, traffic_gb, traffic_both, expires_at, notify)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.tokenHash,
      input.tokenHint,
      input.group ?? 'default',
      input.region ?? '',
      tagsToJson(input.tags ?? []),
      input.hidden ? 1 : 0,
      input.sortOrder ?? 0,
      ts,
      ts,
      coercePrice(input.price ?? ''),
      clampInt(input.trafficGb ?? 0, 0, 1_000_000, 0),
      input.trafficBoth === false ? 0 : 1,
      coerceExpiresAt(input.expiresAt ?? ''),
      input.notify === false ? 0 : 1,
    )
    .run();
  const row = await getNode(db, id);
  if (!row) throw new Error('failed to create node');
  return row;
}

export async function updateNode(
  db: D1Database,
  id: string,
  patch: Record<string, unknown>,
): Promise<NodeRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('name' in patch) {
    sets.push('name = ?');
    binds.push(str(patch.name));
  }
  if ('group' in patch || 'group_name' in patch) {
    const g = 'group' in patch ? patch.group : patch.group_name;
    sets.push('group_name = ?');
    binds.push(str(g, 'default') || 'default');
  }
  if ('region' in patch) {
    sets.push('region = ?');
    binds.push(str(patch.region));
  }
  if ('tags' in patch) {
    sets.push('tags = ?');
    binds.push(tagsToJson(parseTags(patch.tags)));
  }
  if ('hidden' in patch) {
    sets.push('hidden = ?');
    binds.push(bool(patch.hidden) ? 1 : 0);
  }
  if ('sort_order' in patch) {
    sets.push('sort_order = ?');
    binds.push(Math.trunc(num(patch.sort_order)));
  }
  if ('price' in patch) {
    sets.push('price = ?');
    binds.push(coercePrice(patch.price));
  }
  if ('traffic_gb' in patch) {
    sets.push('traffic_gb = ?');
    binds.push(clampInt(patch.traffic_gb, 0, 1_000_000, 0));
  }
  if ('traffic_both' in patch) {
    sets.push('traffic_both = ?');
    binds.push(bool(patch.traffic_both, true) ? 1 : 0);
  }
  if ('traffic_used_gb' in patch) {
    // The operator types the usage they want to see; the difference against
    // what the agent has metered so far is stored as an offset, so reports
    // keep accumulating on top of the correction instead of overwriting it.
    const current = await getNode(db, id);
    if (current !== null) {
      const targetBytes = Math.trunc(
        Math.min(1_000_000, Math.max(0, num(patch.traffic_used_gb))) * 1024 ** 3,
      );
      const metered = meteredMonthBytes(
        'traffic_both' in patch
          ? { ...current, traffic_both: bool(patch.traffic_both, true) ? 1 : 0 }
          : current,
        nowSec(),
      );
      sets.push('traffic_offset = ?');
      binds.push(targetBytes - metered);
      sets.push('traffic_offset_month = ?');
      binds.push(monthKey(nowSec()));
    }
  }
  if ('expires_at' in patch) {
    sets.push('expires_at = ?');
    binds.push(coerceExpiresAt(patch.expires_at));
  }
  if ('notify' in patch) {
    sets.push('notify = ?');
    binds.push(bool(patch.notify, true) ? 1 : 0);
  }
  if (sets.length === 0) return getNode(db, id);
  sets.push('updated_at = ?');
  binds.push(nowSec());
  binds.push(id);
  await db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return getNode(db, id);
}

/**
 * Record the source address (and its country, from Cloudflare's request
 * geolocation) a node last reported from.
 *
 * Deliberately not folded into `updateNode`: the IP and its country are owned
 * by the ingest path (they reflect where reports actually come from), so they
 * must not be settable through the admin PATCH endpoint — a manual value would
 * be silently overwritten by the next report.
 */
export async function setNodeSource(db: D1Database, id: string, ip: string, country: string): Promise<void> {
  await db
    .prepare('UPDATE nodes SET ip = ?, country = ? WHERE id = ?')
    .bind(ip, country, id)
    .run();
}

export async function deleteNode(db: D1Database, id: string): Promise<void> {  await db.batch([
    db.prepare('DELETE FROM metrics WHERE node_id = ?').bind(id),
    db.prepare('DELETE FROM ping_records WHERE node_id = ?').bind(id),
    db.prepare('DELETE FROM ping_tasks WHERE node_id = ?').bind(id),
    db.prepare('DELETE FROM nodes WHERE id = ?').bind(id),
  ]);
}

export async function rotateNodeToken(
  db: D1Database,
  id: string,
  tokenHash: string,
  tokenHint: string,
): Promise<void> {
  await db
    .prepare('UPDATE nodes SET token_hash = ?, token_hint = ?, updated_at = ? WHERE id = ?')
    .bind(tokenHash, tokenHint, nowSec(), id)
    .run();
}

/** Latest sample for a node, from the denormalised column. */
export async function getLatestSample(db: D1Database, id: string): Promise<MetricSample | null> {
  const row = await first<{ latest: string | null }>(
    db.prepare('SELECT latest FROM nodes WHERE id = ?').bind(id),
  );
  if (!row) return null;
  const parsed = parseJsonColumn<Record<string, unknown> | null>(row.latest, null);
  return parsed ? coerceSample(parsed) : null;
}

// ── metrics ─────────────────────────────────────────────────────────────────

const METRIC_COLUMNS =
  'node_id, ts, cpu, mem_used, mem_total, swap_used, swap_total, disk_used, disk_total, ' +
  'net_in, net_out, rx_rate, tx_rate, tcp, udp, process, uptime, load1, load5, load15';

export async function insertMetric(db: D1Database, sample: MetricSample, nodeId: string, ts: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO metrics (${METRIC_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id, ts) DO UPDATE SET
         cpu = excluded.cpu, mem_used = excluded.mem_used, mem_total = excluded.mem_total,
         swap_used = excluded.swap_used, swap_total = excluded.swap_total,
         disk_used = excluded.disk_used, disk_total = excluded.disk_total,
         net_in = excluded.net_in, net_out = excluded.net_out,
         rx_rate = excluded.rx_rate, tx_rate = excluded.tx_rate,
         tcp = excluded.tcp, udp = excluded.udp, process = excluded.process,
         uptime = excluded.uptime, load1 = excluded.load1, load5 = excluded.load5,
         load15 = excluded.load15`,
    )
    .bind(
      nodeId,
      ts,
      sample.cpu,
      sample.mem_used,
      sample.mem_total,
      sample.swap_used,
      sample.swap_total,
      sample.disk_used,
      sample.disk_total,
      sample.net_in,
      sample.net_out,
      sample.rx_rate,
      sample.tx_rate,
      sample.tcp,
      sample.udp,
      sample.process,
      sample.uptime,
      sample.load1,
      sample.load5,
      sample.load15,
    )
    .run();
}

function rowToPoint(row: MetricRow): MetricPoint {
  return {
    ts: num(row.ts),
    cpu: num(row.cpu),
    mem_percent: percent(num(row.mem_used), num(row.mem_total)),
    disk_percent: percent(num(row.disk_used), num(row.disk_total)),
    rx_rate: num(row.rx_rate),
    tx_rate: num(row.tx_rate),
    load1: num(row.load1),
    net_in: Math.trunc(num(row.net_in)),
    net_out: Math.trunc(num(row.net_out)),
  };
}

/**
 * History series (§3.1).
 *
 * Downsampling rule, implemented verbatim:
 *   `hours <= 6` → raw rows.
 *   otherwise    → `step = ceil(hours*3600/360)`, bucket key `(ts/step)*step`,
 *                  gauges averaged, `net_in`/`net_out` use MAX (cumulative).
 * `hours` is clamped to 1..168.
 */
export async function getMetricSeries(
  db: D1Database,
  nodeId: string,
  hoursInput: unknown,
  now: number,
): Promise<MetricSeries> {
  const hours = clampInt(hoursInput, 1, 168, 1);
  const from = now - hours * 3600;
  const to = now;

  if (hours <= 6) {
    const rows = await all<MetricRow>(
      db
        .prepare(`SELECT ${METRIC_COLUMNS} FROM metrics WHERE node_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC`)
        .bind(nodeId, from, to),
    );
    return { node_id: nodeId, from, to, step: 1, points: rows.map(rowToPoint) };
  }

  const step = Math.ceil((hours * 3600) / 360);
  // Two subtleties, both required for correct bucketing:
  //  1. `CAST(? AS INTEGER)` — a bound JS number arrives as REAL, and SQLite
  //     would then perform float division, so the bucket key would never align.
  //  2. the bucket alias must NOT be named `ts`. `GROUP BY` prefers a real
  //     input column over an output alias of the same name, so `AS ts ...
  //     GROUP BY ts` would silently group by the raw timestamp and return every
  //     row. The alias is `bucket`, renamed to `ts` by the outer SELECT.
  const rows = await all<MetricRow>(
    db
      .prepare(
        `SELECT bucket AS ts, cpu, mem_used, mem_total, disk_used, disk_total,
                rx_rate, tx_rate, load1, net_in, net_out
           FROM (
             SELECT (CAST(? AS INTEGER) * (ts / CAST(? AS INTEGER))) AS bucket,
                    AVG(cpu)        AS cpu,
                    AVG(mem_used)   AS mem_used,
                    AVG(mem_total)  AS mem_total,
                    AVG(disk_used)  AS disk_used,
                    AVG(disk_total) AS disk_total,
                    AVG(rx_rate)    AS rx_rate,
                    AVG(tx_rate)    AS tx_rate,
                    AVG(load1)      AS load1,
                    MAX(net_in)     AS net_in,
                    MAX(net_out)    AS net_out
               FROM metrics
              WHERE node_id = ? AND ts >= ? AND ts <= ?
              GROUP BY bucket
           )
          ORDER BY ts ASC`,
      )
      .bind(step, step, nodeId, from, to),
  );
  return { node_id: nodeId, from, to, step, points: rows.map(rowToPoint) };
}

// ── ping tasks / records ────────────────────────────────────────────────────

export async function listPingTasks(db: D1Database, nodeId?: string): Promise<PingTaskRow[]> {
  if (nodeId) {
    return all<PingTaskRow>(
      db.prepare('SELECT * FROM ping_tasks WHERE node_id = ? ORDER BY name ASC').bind(nodeId),
    );
  }
  return all<PingTaskRow>(db.prepare('SELECT * FROM ping_tasks ORDER BY node_id ASC, name ASC'));
}

export async function getPingTask(db: D1Database, id: string): Promise<PingTaskRow | null> {
  return first<PingTaskRow>(db.prepare('SELECT * FROM ping_tasks WHERE id = ?').bind(id));
}

export async function findPingTask(
  db: D1Database,
  nodeId: string,
  name: string,
  target: string,
): Promise<PingTaskRow | null> {
  return first<PingTaskRow>(
    db.prepare('SELECT * FROM ping_tasks WHERE node_id = ? AND name = ? AND target = ?').bind(nodeId, name, target),
  );
}

export interface PingTaskInput {
  node_id: string;
  name: string;
  type: string;
  target: string;
  interval?: number;
  enabled?: boolean;
}

function pingType(value: unknown): 'icmp' | 'tcp' | 'http' {
  const t = str(value).toLowerCase();
  return t === 'icmp' || t === 'http' ? t : 'tcp';
}

export async function createPingTask(db: D1Database, input: PingTaskInput): Promise<PingTaskRow> {
  const id = uuid();
  await db
    .prepare('INSERT INTO ping_tasks (id, node_id, name, type, target, interval, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      input.node_id,
      input.name,
      pingType(input.type),
      input.target,
      clampInt(input.interval, 1, 86400, 60),
      input.enabled === false ? 0 : 1,
    )
    .run();
  const row = await getPingTask(db, id);
  if (!row) throw new Error('failed to create ping task');
  return row;
}

export async function updatePingTask(
  db: D1Database,
  id: string,
  patch: Record<string, unknown>,
): Promise<PingTaskRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('name' in patch) {
    sets.push('name = ?');
    binds.push(str(patch.name));
  }
  if ('type' in patch) {
    sets.push('type = ?');
    binds.push(pingType(patch.type));
  }
  if ('target' in patch) {
    sets.push('target = ?');
    binds.push(str(patch.target));
  }
  if ('interval' in patch) {
    sets.push('interval = ?');
    binds.push(clampInt(patch.interval, 1, 86400, 60));
  }
  if ('enabled' in patch) {
    sets.push('enabled = ?');
    binds.push(bool(patch.enabled) ? 1 : 0);
  }
  if (sets.length === 0) return getPingTask(db, id);
  binds.push(id);
  await db.prepare(`UPDATE ping_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return getPingTask(db, id);
}

export async function deletePingTask(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM ping_records WHERE task_id = ?').bind(id),
    db.prepare('DELETE FROM ping_tasks WHERE id = ?').bind(id),
  ]);
}

export async function insertPingRecord(
  db: D1Database,
  taskId: string,
  nodeId: string,
  ts: number,
  value: number,
  okFlag: boolean,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ping_records (task_id, node_id, ts, value, ok) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id, ts) DO UPDATE SET value = excluded.value, ok = excluded.ok`,
    )
    .bind(taskId, nodeId, ts, value, okFlag ? 1 : 0)
    .run();
}

/**
 * Per-task summaries: latest sample, 24h average (successful probes only, since
 * failed probes are stored as -1) and 24h loss percentage.
 */
export async function getPingSummaries(
  db: D1Database,
  nodeId: string,
  now: number,
  seriesHours = 24,
): Promise<PingTaskWithSeries[]> {
  const tasks = await listPingTasks(db, nodeId);
  if (tasks.length === 0) return [];
  const since = now - 24 * 3600;

  const latestRows = await all<{ task_id: string; ts: number; value: number; ok: number }>(
    db.prepare(
      `SELECT task_id, ts, value, ok FROM (
         SELECT task_id, ts, value, ok,
                ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY ts DESC) AS rn
           FROM ping_records WHERE node_id = ?
       ) WHERE rn = 1`,
    ).bind(nodeId),
  );
  const aggRows = await all<{ task_id: string; avg_value: number | null; failures: number; total: number }>(
    db.prepare(
      `SELECT task_id,
              AVG(CASE WHEN ok = 1 THEN value END) AS avg_value,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
              COUNT(*) AS total
         FROM ping_records
        WHERE node_id = ? AND ts >= ?
        GROUP BY task_id`,
    ).bind(nodeId, since),
  );
  const seriesRows = await all<{ task_id: string; ts: number; value: number; ok: number }>(
    db
      .prepare(
        `SELECT task_id, ts, value, ok FROM ping_records
          WHERE node_id = ? AND ts >= ?
          ORDER BY ts ASC LIMIT 5000`,
      )
      .bind(nodeId, now - clampInt(seriesHours, 1, 168, 24) * 3600),
  );

  const latestByTask = new Map(latestRows.map((r) => [r.task_id, r]));
  const aggByTask = new Map(aggRows.map((r) => [r.task_id, r]));
  const seriesByTask = new Map<string, PingSeriesPoint[]>();
  for (const r of seriesRows) {
    const list = seriesByTask.get(r.task_id) ?? [];
    list.push({ ts: num(r.ts), value: num(r.value), ok: bool(r.ok) });
    seriesByTask.set(r.task_id, list);
  }

  return tasks.map((task) => {
    const latest = latestByTask.get(task.id);
    const agg = aggByTask.get(task.id);
    const total = num(agg?.total);
    const failures = num(agg?.failures);
    const summary: PingTaskSummary = {
      id: task.id,
      name: task.name,
      type: pingType(task.type),
      target: task.target,
      interval: num(task.interval, 60),
      enabled: bool(task.enabled, true),
      latest: latest ? { ts: num(latest.ts), value: num(latest.value), ok: bool(latest.ok) } : null,
      avg_24h: agg && agg.avg_value !== null && agg.avg_value !== undefined ? Math.round(num(agg.avg_value) * 100) / 100 : -1,
      loss_24h: total > 0 ? Math.round((failures / total) * 10000) / 100 : 0,
    };
    return { ...summary, series: seriesByTask.get(task.id) ?? [] };
  });
}

// ── uptime monitors ─────────────────────────────────────────────────────────

function uptimeMethod(value: unknown): 'GET' | 'HEAD' {
  return str(value).trim().toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
}

/** Percentage of successful checks, `-1` when the window holds no rows. */
function successRate(ok: number, total: number): number {
  if (total <= 0) return -1;
  return Math.round((ok / total) * 10_000) / 100;
}

function mapUptimeSummary(row: UptimeMonitorRow, stat: UptimeStatRow | undefined): UptimeMonitorSummary {
  return {
    id: str(row.id),
    name: str(row.name),
    url: str(row.url),
    method: uptimeMethod(row.method),
    interval: num(row.interval, UPTIME_DEFAULT_INTERVAL),
    expected_status: normalizeExpectedStatus(row.expected_status),
    timeout_ms: num(row.timeout_ms, UPTIME_DEFAULT_TIMEOUT),
    enabled: num(row.enabled, 1) !== 0,
    ok: num(row.last_ok) !== 0,
    last_checked: num(row.last_checked),
    last_status: num(row.last_status),
    last_latency: num(row.last_latency),
    last_error: str(row.last_error),
    uptime_24h: successRate(num(stat?.ok_24h), num(stat?.total_24h)),
    uptime_7d: successRate(num(stat?.ok_7d), num(stat?.total_7d)),
    avg_latency_24h:
      stat?.avg_latency === null || stat?.avg_latency === undefined
        ? -1
        : Math.round(num(stat.avg_latency)),
    checks_24h: num(stat?.total_24h),
    created_at: num(row.created_at),
  };
}

export async function listUptimeMonitors(db: D1Database, includeDisabled = true): Promise<UptimeMonitorRow[]> {
  const sql = includeDisabled
    ? 'SELECT * FROM uptime_monitors ORDER BY name ASC, created_at ASC'
    : 'SELECT * FROM uptime_monitors WHERE enabled = 1 ORDER BY name ASC, created_at ASC';
  return all<UptimeMonitorRow>(db.prepare(sql));
}

export async function getUptimeMonitor(db: D1Database, id: string): Promise<UptimeMonitorRow | null> {
  return first<UptimeMonitorRow>(db.prepare('SELECT * FROM uptime_monitors WHERE id = ?').bind(id));
}

export interface UptimeMonitorInput {
  name?: string;
  url: string;
  method?: unknown;
  interval?: unknown;
  expectedStatus?: unknown;
  timeoutMs?: unknown;
  enabled?: unknown;
}

export async function createUptimeMonitor(
  db: D1Database,
  input: UptimeMonitorInput,
): Promise<UptimeMonitorRow> {
  const url = normalizeMonitorUrl(input.url);
  if (url === null) throw new Error('invalid monitor url');
  const name = str(input.name).trim().slice(0, 120) || defaultMonitorName(url);
  const id = uuid();
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO uptime_monitors
         (id, name, url, method, interval, expected_status, timeout_ms, enabled,
          last_checked, last_status, last_latency, last_ok, last_error, notified_down,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '', 0, ?, ?)`,
    )
    .bind(
      id,
      name,
      url,
      uptimeMethod(input.method),
      clampInt(input.interval, UPTIME_MIN_INTERVAL, UPTIME_MAX_INTERVAL, UPTIME_DEFAULT_INTERVAL),
      normalizeExpectedStatus(input.expectedStatus),
      clampInt(input.timeoutMs, UPTIME_MIN_TIMEOUT, UPTIME_MAX_TIMEOUT, UPTIME_DEFAULT_TIMEOUT),
      bool(input.enabled, true) ? 1 : 0,
      ts,
      ts,
    )
    .run();
  const row = await getUptimeMonitor(db, id);
  if (!row) throw new Error('failed to create uptime monitor');
  return row;
}

/**
 * Partial update. `url` is re-validated: a bad value is ignored rather than
 * stored, so a typo cannot leave a monitor that can never be probed.
 */
export async function updateUptimeMonitor(
  db: D1Database,
  id: string,
  patch: Record<string, unknown>,
): Promise<UptimeMonitorRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('name' in patch) {
    const name = str(patch.name).trim().slice(0, 120);
    if (name !== '') {
      sets.push('name = ?');
      binds.push(name);
    }
  }
  if ('url' in patch) {
    const url = normalizeMonitorUrl(patch.url);
    if (url !== null) {
      sets.push('url = ?');
      binds.push(url);
    }
  }
  if ('method' in patch) {
    sets.push('method = ?');
    binds.push(uptimeMethod(patch.method));
  }
  if ('interval' in patch) {
    sets.push('interval = ?');
    binds.push(clampInt(patch.interval, UPTIME_MIN_INTERVAL, UPTIME_MAX_INTERVAL, UPTIME_DEFAULT_INTERVAL));
  }
  if ('expected_status' in patch) {
    sets.push('expected_status = ?');
    binds.push(normalizeExpectedStatus(patch.expected_status));
  }
  if ('timeout_ms' in patch) {
    sets.push('timeout_ms = ?');
    binds.push(clampInt(patch.timeout_ms, UPTIME_MIN_TIMEOUT, UPTIME_MAX_TIMEOUT, UPTIME_DEFAULT_TIMEOUT));
  }
  if ('enabled' in patch) {
    sets.push('enabled = ?');
    binds.push(bool(patch.enabled, true) ? 1 : 0);
  }
  if (sets.length === 0) return getUptimeMonitor(db, id);
  sets.push('updated_at = ?');
  binds.push(nowSec());
  binds.push(id);
  await db.prepare(`UPDATE uptime_monitors SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return getUptimeMonitor(db, id);
}

export async function deleteUptimeMonitor(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM uptime_checks WHERE monitor_id = ?').bind(id),
    db.prepare('DELETE FROM uptime_monitors WHERE id = ?').bind(id),
  ]);
}

interface UptimeStatRow {
  monitor_id: string;
  total_24h: number;
  ok_24h: number;
  avg_latency: number | null;
  total_7d: number;
  ok_7d: number;
}

/**
 * Monitors plus their rolling availability numbers.
 *
 * Both windows are aggregated in a single pass over the 7-day slice, with the
 * 24-hour figures expressed as conditional sums. `uptime_*` is the share of
 * successful probes, which is what an operator means by "uptime" — it is not
 * time-weighted, so a monitor that stopped being checked shows the numbers it
 * actually collected.
 */
export async function getUptimeSummaries(
  db: D1Database,
  now: number,
  includeDisabled = false,
): Promise<UptimeMonitorSummary[]> {
  const rows = await listUptimeMonitors(db, includeDisabled);
  if (rows.length === 0) return [];
  const since24 = now - 86_400;
  const since7d = now - 7 * 86_400;
  const stats = await all<UptimeStatRow>(
    db
      .prepare(
        `SELECT monitor_id,
                SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END)                     AS total_24h,
                SUM(CASE WHEN ts >= ? AND ok = 1 THEN 1 ELSE 0 END)          AS ok_24h,
                AVG(CASE WHEN ts >= ? AND ok = 1 THEN latency END)           AS avg_latency,
                COUNT(*)                                                     AS total_7d,
                SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END)                      AS ok_7d
           FROM uptime_checks
          WHERE ts >= ?
          GROUP BY monitor_id`,
      )
      .bind(since24, since24, since24, since7d),
  );
  const byMonitor = new Map(stats.map((row) => [row.monitor_id, row]));
  return rows.map((row) => mapUptimeSummary(row, byMonitor.get(row.id)));
}

/** Newest-first probe history for one monitor (admin detail view). */
export async function listUptimeChecks(
  db: D1Database,
  monitorId: string,
  limit = 100,
): Promise<UptimeCheckPoint[]> {
  const rows = await all<{ ts: number; status: number; latency: number; ok: number; error: string }>(
    db
      .prepare(
        'SELECT ts, status, latency, ok, error FROM uptime_checks WHERE monitor_id = ? ORDER BY ts DESC LIMIT ?',
      )
      .bind(monitorId, clampInt(limit, 1, 1000, 100)),
  );
  return rows.map((row) => ({
    ts: num(row.ts),
    status: num(row.status),
    latency: num(row.latency),
    ok: num(row.ok) !== 0,
    error: str(row.error),
  }));
}

// ── status ──────────────────────────────────────────────────────────────────

export async function getPublicStatus(
  db: D1Database,
  settings: Settings,
  now: number,
): Promise<PublicStatus> {
  const rows = await all<{ last_seen: number }>(
    db.prepare('SELECT last_seen FROM nodes WHERE hidden = 0'),
  );
  let online = 0;
  for (const row of rows) {
    if (isOnline(row, settings.offline_after, now)) online++;
  }
  const total = rows.length;
  return {
    site_name: settings.site_name,
    site_description: settings.site_description,
    online,
    offline: total - online,
    total,
    generated_at: now,
  };
}

// ── users / sessions ────────────────────────────────────────────────────────

export async function countUsers(db: D1Database): Promise<number> {
  const row = await first<{ c: number }>(db.prepare('SELECT COUNT(*) AS c FROM users'));
  return num(row?.c);
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return first<UserRow>(db.prepare('SELECT * FROM users WHERE username = ?').bind(username));
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return first<UserRow>(db.prepare('SELECT * FROM users WHERE id = ?').bind(id));
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  return all<UserRow>(db.prepare('SELECT * FROM users ORDER BY created_at ASC'));
}

export async function createUser(
  db: D1Database,
  username: string,
  passwordHash: string,
  role: string,
): Promise<UserRow> {
  const id = uuid();
  await db
    .prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, username, passwordHash, role, nowSec())
    .run();
  const row = await getUserById(db, id);
  if (!row) throw new Error('failed to create user');
  return row;
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
}

export async function updateUserPassword(db: D1Database, id: string, passwordHash: string): Promise<void> {
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, id).run();
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await first<{ c: number }>(db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'"));
  return num(row?.c);
}

export async function createSession(
  db: D1Database,
  id: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  const ts = nowSec();
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, ts, ts + ttlSeconds)
    .run();
}

/** Resolve a session id to its (non-expired) user. */
export async function getSessionUser(db: D1Database, sessionId: string): Promise<UserRow | null> {
  const row = await first<UserRow>(
    db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > ?`,
      )
      .bind(sessionId, nowSec()),
  );
  return row;
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

// ── audit ───────────────────────────────────────────────────────────────────

export async function writeAudit(
  db: D1Database,
  entry: { user: string; action: string; target?: string; detail?: string; ip?: string },
): Promise<void> {
  await db
    .prepare('INSERT INTO audit_logs (id, ts, user, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      uuid(),
      nowSec(),
      entry.user ?? '',
      entry.action,
      entry.target ?? '',
      entry.detail ?? '',
      entry.ip ?? '',
    )
    .run();
}

export async function listAudit(db: D1Database, limit: number): Promise<AuditLogRow[]> {
  return all<AuditLogRow>(
    db.prepare('SELECT * FROM audit_logs ORDER BY ts DESC LIMIT ?').bind(clampInt(limit, 1, 1000, 100)),
  );
}

// ── overview ────────────────────────────────────────────────────────────────

export async function getOverview(
  db: D1Database,
  settings: Settings,
  now: number,
): Promise<Record<string, unknown>> {
  const nodes = await all<{ last_seen: number }>(db.prepare('SELECT last_seen FROM nodes WHERE hidden = 0'));
  let online = 0;
  for (const n of nodes) if (isOnline(n, settings.offline_after, now)) online++;
  const agg = await first<{ c: number; oldest: number | null }>(
    db.prepare('SELECT COUNT(*) AS c, MIN(ts) AS oldest FROM metrics'),
  );
  let d1Size = 0;
  try {
    const sizeRow = await first<{ size: number }>(
      db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()'),
    );
    d1Size = num(sizeRow?.size);
  } catch {
    d1Size = 0;
  }
  return {
    nodes: nodes.length,
    online,
    offline: nodes.length - online,
    metrics_rows: num(agg?.c),
    oldest_ts: agg?.oldest === null || agg?.oldest === undefined ? 0 : num(agg.oldest),
    d1_size: d1Size,
  };
}
