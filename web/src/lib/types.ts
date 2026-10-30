/**
 * Local mirror of the shared DTOs from `docs/CONTRACT.md` §3.
 * The SPA cannot import from `worker/`, so these are declared by hand and must
 * stay byte-compatible with the contract.
 */

/** The sample the agent sends and the worker stores. */
export interface MetricSample {
  /** 0-100 */
  cpu: number;
  mem_used: number;
  mem_total: number;
  swap_used: number;
  swap_total: number;
  disk_used: number;
  disk_total: number;
  /** cumulative bytes */
  net_in: number;
  net_out: number;
  /** bytes/sec over the last interval */
  rx_rate: number;
  tx_rate: number;
  tcp: number;
  udp: number;
  process: number;
  /** seconds */
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
}

/** Static hardware identity from the agent's `host` envelope. */
export interface NodeHostInfo {
  cpu_model: string;
  cpu_cores: number;
}

export interface NodeSummary {
  id: string;
  name: string;
  /** from `group_name` */
  group: string;
  region: string;
  tags: string[];
  /** Source address of the last report; `''` until the node first checks in. */
  ip: string;
  hidden: boolean;
  online: boolean;
  last_seen: number;
  /** seconds */
  uptime: number;
  created_at: number;
  metrics: MetricSample | null;
  /** CPU model / core count; present in newer workers, null until reported. */
  host?: NodeHostInfo | null;
  /** Operator-set plan metadata ('' / 0 = unset). */
  price: string;
  /** Monthly traffic quota in GB; 0 = unset/unlimited. */
  traffic_gb: number;
  /** True = the quota counts down + up; false = outbound only. */
  traffic_both: boolean;
  /** Bytes moved since the start of the current month. */
  traffic_month_in: number;
  traffic_month_out: number;
  /** Usage the quota meters this month, including any manual correction. */
  traffic_used: number;
  /** True when an operator's manual correction is currently in effect. */
  traffic_corrected: boolean;
  /** Expiry date 'YYYY-MM-DD'; '' = none. */
  expires_at: string;
  /** False = excluded from Telegram offline/recovery alerts. */
  notify: boolean;
  /** ISO-3166 alpha-2 country of the source IP; '' = unknown. */
  country: string;
  /** derived helpers computed by the worker */
  cpu: number;
  mem_percent: number;
  disk_percent: number;
  load1: number;
}

export type PingType = 'icmp' | 'tcp' | 'http';

export interface PingTaskSummary {
  id: string;
  name: string;
  type: PingType;
  target: string;
  interval: number;
  enabled: boolean;
  latest: { ts: number; value: number; ok: boolean } | null;
  /** -1 when no data */
  avg_24h: number;
  /** 0-100 */
  loss_24h: number;
}

export interface NodeDetail extends NodeSummary {
  pings: PingTaskSummary[];
}

export interface PublicStatus {
  site_name: string;
  site_description: string;
  online: number;
  offline: number;
  total: number;
  generated_at: number;
}

/* ── §3.1 history payload ─────────────────────────────────────────────────── */

export interface MetricPoint {
  ts: number;
  cpu: number;
  mem_percent: number;
  disk_percent: number;
  rx_rate: number;
  tx_rate: number;
  load1: number;
  net_in: number;
  net_out: number;
}

export interface MetricSeries {
  node_id: string;
  from: number;
  to: number;
  /** seconds per bucket (worker-side downsampling) */
  step: number;
  points: MetricPoint[];
}

/* ── §4.2 public read API ─────────────────────────────────────────────────── */

export interface NodesResponse {
  nodes: NodeSummary[];
  status: PublicStatus;
}

export interface GroupCount {
  name: string;
  count: number;
}

export interface GroupsResponse {
  groups: GroupCount[];
}

/** A ping series point, as returned alongside each task by `/api/nodes/:id/pings`. */
export interface PingSeriesPoint {
  ts: number;
  value: number;
  ok: boolean;
}

export interface PingTaskWithSeries extends PingTaskSummary {
  series: PingSeriesPoint[];
}

export interface NodePingsResponse {
  pings: PingTaskWithSeries[];
}

/* ── uptime monitors ──────────────────────────────────────────────────────── */

export type UptimeMethod = 'GET' | 'HEAD';

export interface UptimeMonitor {
  id: string;
  name: string;
  url: string;
  method: UptimeMethod;
  /** seconds between checks */
  interval: number;
  /** `2xx` or an exact code list such as `200,204` */
  expected_status: string;
  timeout_ms: number;
  enabled: boolean;
  ok: boolean;
  /** epoch seconds; 0 = never checked */
  last_checked: number;
  /** HTTP status; 0 = no response */
  last_status: number;
  last_latency: number;
  last_error: string;
  /** percentage of successful checks; -1 when no data */
  uptime_24h: number;
  uptime_7d: number;
  /** ms; -1 when no data */
  avg_latency_24h: number;
  checks_24h: number;
  created_at: number;
}

export interface UptimeBoard {
  monitors: UptimeMonitor[];
  summary: { total: number; up: number; down: number; generated_at: number };
}

/** Outcome of `POST /api/admin/uptime/check` — the "paste a URL, get its code" probe. */
export interface UptimeProbeResult {
  url: string;
  ok: boolean;
  status: number;
  latency_ms: number;
  final_url: string;
  error: string;
  expected_status: string;
}

export interface UptimeCheckPoint {
  ts: number;
  status: number;
  latency: number;
  ok: boolean;
  error: string;
}

export interface AdminUptimeResponse {
  monitors: UptimeMonitor[];
}

export interface AdminUptimeDetailResponse {
  monitor: UptimeMonitor;
  checks: UptimeCheckPoint[];
}

/** `GET /api/uptime/:id` — public detail page payload. */
export interface UptimeDetailResponse {
  monitor: UptimeMonitor;
  /** Newest first, bounded by the `limit` query parameter. */
  checks: UptimeCheckPoint[];
}

export interface UptimeMonitorInput {
  name?: string;
  url: string;
  method?: UptimeMethod;
  interval?: number;
  expected_status?: string;
  timeout_ms?: number;
  enabled?: boolean;
}

/* ── §4.3 auth API ────────────────────────────────────────────────────────── */

export type UserRole = 'admin' | 'viewer';

export interface User {
  id: string;
  username: string;
  role: UserRole;
}

export interface LoginResponse {
  ok: true;
  user: User;
  /** present (and true) only on the very first bootstrap login */
  bootstrap?: boolean;
}

export interface MeResponse {
  user: User;
}

/* ── §4.4 admin API ───────────────────────────────────────────────────────── */

/** `/api/admin/nodes` rows add the token hint that the public DTO omits. */
export interface AdminNode extends NodeSummary {
  token_hint: string;
  sort_order: number;
  updated_at: number;
}

export interface AdminNodesResponse {
  nodes: AdminNode[];
}

export interface CreateNodeInput {
  name: string;
  group?: string;
  region?: string;
  tags?: string[];
  hidden?: boolean;
  sort_order?: number;
  price?: string;
  traffic_gb?: number;
  traffic_both?: boolean;
  /** Absolute "used this month" in GB; stored as an offset server-side. */
  traffic_used_gb?: number;
  expires_at?: string;
  notify?: boolean;
}

export interface UpdateNodeInput {
  name?: string;
  group?: string;
  region?: string;
  tags?: string[];
  hidden?: boolean;
  sort_order?: number;
  price?: string;
  traffic_gb?: number;
  traffic_both?: boolean;
  /** Absolute "used this month" in GB; stored as an offset server-side. */
  traffic_used_gb?: number;
  expires_at?: string;
  notify?: boolean;
}

export interface CreateNodeResponse {
  ok: true;
  node: AdminNode;
  /** plaintext agent token — returned once, never retrievable again */
  token: string;
}

export interface RotateTokenResponse {
  ok: true;
  token: string;
}

export interface AdminPingTask {
  id: string;
  node_id: string;
  name: string;
  type: PingType;
  target: string;
  interval: number;
  enabled: boolean;
}

export interface AdminPingsResponse {
  pings: AdminPingTask[];
}

export interface PingTaskInput {
  node_id: string;
  name: string;
  type: PingType;
  target: string;
  interval?: number;
  enabled?: boolean;
}

export type PingTaskPatch = Partial<Omit<PingTaskInput, 'node_id'>>;

/** §2.1 `settings` keys, fully populated by `getSettings()`. */
export interface Settings {
  site_name: string;
  site_description: string;
  report_interval: number;
  offline_after: number;
  retention_days: number;
  ping_retention_days: number;
  theme: ThemeSetting;
  custom_head: string;
  /** present in newer workers; optional so older ones still typecheck */
  allow_auto_register?: boolean;
  /** Telegram notifications; optional so older workers still typecheck */
  tg_bot_token?: string;
  tg_chat_id?: string;
  tg_notify_offline?: boolean;
  tg_notify_online?: boolean;
  /** alert when a website monitor goes down / recovers; optional for older workers */
  tg_notify_uptime?: boolean;
}

export type ThemeSetting = 'auto' | 'light' | 'dark';

export interface AdminUsersResponse {
  users: User[];
}

export interface AuditRow {
  id: string;
  ts: number;
  user: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

export interface AuditResponse {
  audit: AuditRow[];
}

export interface AdminOverview {
  nodes: number;
  online: number;
  offline: number;
  metrics_rows: number;
  oldest_ts: number;
  d1_size: number;
}

/** Generic mutation acknowledgement used by most admin endpoints. */
export interface OkResponse {
  ok: true;
}

/** §4 error envelope. */
export interface ApiErrorBody {
  error: string;
  message?: string;
}
