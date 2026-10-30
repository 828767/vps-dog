# VPS-DOG — 接口契约（v1）

> **本文件是跨组件接口的单一事实来源。**
> 每位协作者都必须严格按照此处规定的内容实现。如果你认为需要做出
> 变更，请告知 Lead —— 不要擅自偏离。

VPS-DOG 是一个轻量级服务器监控工具（思路借鉴 Komari / Nezha），
**完全运行在 Cloudflare Workers** 上，并以 **D1** 作为数据存储。
一个极小的 Go Agent 负责上报指标；一个 React SPA 渲染简洁的仪表盘。

```
┌─────────────┐   HTTPS POST /api/v1/report    ┌──────────────────────┐
│  Go agent   │ ─────────────────────────────► │  CF Worker (Hono)    │
│  (any VPS)  │ ◄───────────────────────────── │  + D1 (SQLite)       │
└─────────────┘   {ok, interval, pings[]}      └──────────┬───────────┘
                                                          │ static assets
                                              ┌───────────▼───────────┐
                                              │  React SPA (Workers   │
                                              │  Static Assets)       │
                                              └───────────────────────┘
```

---

## 1. 目录结构

```
VPS-DOG/
├── worker/                 # Cloudflare Worker (TypeScript, Hono)  [owner: worker-backend]
│   ├── src/
│   │   ├── index.ts        # entry: fetch + scheduled handlers
│   │   ├── router.ts       # app assembly + asset fallback
│   │   ├── db.ts           # D1 access layer + typed row mappers
│   │   ├── types.ts        # Env, DTOs, shared types
│   │   ├── auth.ts         # session + bearer auth, password hashing
│   │   ├── util.ts         # id, json, time, validation helpers
│   │   ├── cron.ts         # retention / offline sweep
│   │   └── routes/
│   │       ├── agent.ts    # /api/v1/report  (agent ingest)
│   │       ├── public.ts   # /api/nodes, /api/status, ...
│   │       └── admin.ts    # /api/auth/*, /api/admin/*
│   ├── migrations/         # 0001_init.sql ...  [APPLIED IN FILENAME ORDER]
│   ├── test/               # vitest + @cloudflare/vitest-pool-workers
│   ├── wrangler.test.toml  # test-only config (no [assets]); see §4.5
│   ├── package.json
│   └── tsconfig.json
├── web/                    # React 19 + Vite + TypeScript SPA  [owner: web-frontend]
│   ├── src/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
├── agent/                  # Go agent  [owner: go-agent]
│   ├── main.go
│   ├── go.mod
│   ├── internal/
│   └── build.sh / build.ps1
├── docs/                   # [owner: docs-devops]
├── .github/workflows/      # [owner: docs-devops]
├── wrangler.toml           # Worker deploy config — MUST stay at the repo root
├── .dev.vars.example       # secret template read by the Deploy to Cloudflare flow
├── package.json            # root scripts: build / deploy / test / typecheck
├── README.md               # [owner: lead]
└── LICENSE                 # [owner: lead]  MIT
```

**写入范围规则：** 每位协作者只能在自己所属的目录内写入。
根级文件（`README.md`、`LICENSE`、`.gitignore`、`docs/`）归
Lead / docs-devops 所有。绝不要编辑其他负责人的文件。

---

## 2. D1 表结构（迁移 `0001_init.sql`）

所有时间戳均为 **Unix 纪元秒（INTEGER）**。所有字节大小均为
**字节（INTEGER）**。百分比为 **0–100 的 REAL**。

```sql
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
  latest      TEXT,                      -- JSON MetricSample | NULL
  ip          TEXT NOT NULL DEFAULT '',  -- source address of the last report (§4.1)
  -- later migrations (0002–0005), listed here for the full picture:
  notified_offline INTEGER NOT NULL DEFAULT 0, -- notifier send-state, NOT an online flag
  host_info   TEXT,                      -- JSON {cpu_model, cpu_cores} | NULL (§4.1)
  price       TEXT NOT NULL DEFAULT '',  -- operator-set display text ('' = unset)
  traffic_gb  INTEGER NOT NULL DEFAULT 0,-- monthly quota in GB; 0 = unlimited
  traffic_both INTEGER NOT NULL DEFAULT 1,-- 1 = quota counts down+up; 0 = up only
  traffic_month TEXT NOT NULL DEFAULT '',-- 'YYYY-MM' the counters belong to
  traffic_month_in  INTEGER NOT NULL DEFAULT 0, -- bytes this month (§4.1)
  traffic_month_out INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL DEFAULT '',  -- ISO date 'YYYY-MM-DD'; '' = none
  notify      INTEGER NOT NULL DEFAULT 1,-- 0 = excluded from Telegram alerts (§4.4.1)
  country     TEXT NOT NULL DEFAULT ''   -- ISO-3166 alpha-2 of source IP (§4.1)
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
```

### 2.1 `settings` 键

| key                 | default      | meaning                                            |
| ------------------- | ------------ | -------------------------------------------------- |
| `site_name`         | `VPS-DOG`    | 仪表盘标题                                          |
| `site_description`  | `""`         | 副标题                                              |
| `report_interval`   | `30`         | Agent 两次上报之间应等待的秒数                       |
| `offline_after`     | `90`         | 超过该秒数未收到上报，节点即视为离线                 |
| `retention_days`    | `30`         | 早于该天数的指标行会被定时任务清除                   |
| `ping_retention_days`| `7`         | 早于该天数的探测行会被定时任务清除                   |
| `theme`             | `auto`       | `auto` \| `light` \| `dark`                        |
| `custom_head`       | `""`         | 注入到 SPA 外壳 `</head>` 之前的原始 HTML            |
| `allow_auto_register`| `false`     | 未知 Agent 令牌上报时是否创建节点                    |
| `tg_bot_token`      | `""`         | Telegram Bot Token（@BotFather 签发）；与 `tg_chat_id` 任一为空即关闭通知 |
| `tg_chat_id`        | `""`         | 接收通知的用户 / 群组 / 频道 ID                     |
| `tg_notify_offline` | `true`       | 节点离线时发送 Telegram 通知                        |
| `tg_notify_online`  | `false`      | 节点恢复上线时发送 Telegram 通知                    |
| `tg_notify_uptime`  | `true`       | 网站可用性监控异常 / 恢复时发送 Telegram 通知        |

设置通过 `getSettings(db)` 读取，返回一个已完整填充的对象
（默认值已合并）。写入时未知键会被忽略。

---

## 3. 共享 DTO

```ts
// The sample the agent sends and the worker stores.
interface MetricSample {
  cpu: number;          // 0-100
  mem_used: number;     // bytes
  mem_total: number;
  swap_used: number;
  swap_total: number;
  disk_used: number;
  disk_total: number;
  net_in: number;       // cumulative bytes
  net_out: number;
  rx_rate: number;      // bytes/sec over the last interval
  tx_rate: number;
  tcp: number;
  udp: number;
  process: number;
  uptime: number;       // seconds
  load1: number;
  load5: number;
  load15: number;
}

interface NodeSummary {
  id: string;
  name: string;
  group: string;        // from group_name
  region: string;
  tags: string[];
  ip: string;           // source address of the last report; '' until first contact
  hidden: boolean;
  online: boolean;
  last_seen: number;
  uptime: number;       // seconds
  created_at: number;
  metrics: MetricSample | null;
  host: { cpu_model: string; cpu_cores: number } | null;  // hardware identity (§4.1)
  price: string;        // operator-set display text; '' = unset (§4.4)
  traffic_gb: number;   // monthly quota in GB; 0 = unlimited
  traffic_both: boolean;// true = quota meters down+up; false = up only
  traffic_month_in: number;  // bytes moved this month (see below)
  traffic_month_out: number;
  expires_at: string;   // 'YYYY-MM-DD'; '' = none
  notify: boolean;      // false = excluded from Telegram alerts (§4.4.1)
  country: string;      // ISO-3166 alpha-2 of the source IP; '' = unknown (§4.1)
  // derived helpers computed by the worker
  cpu: number;
  mem_percent: number;
  disk_percent: number;
  load1: number;
}

interface NodeDetail extends NodeSummary {
  pings: PingTaskSummary[];
}

interface PingTaskSummary {
  id: string;
  name: string;
  type: 'icmp' | 'tcp' | 'http';
  target: string;
  interval: number;
  enabled: boolean;
  latest: { ts: number; value: number; ok: boolean } | null;
  avg_24h: number;      // -1 when no data
  loss_24h: number;     // 0-100
}

interface PublicStatus {
  site_name: string;
  site_description: string;
  online: number;
  offline: number;
  total: number;
  generated_at: number;
}
```

### 3.1 历史数据载荷

```ts
// GET /api/nodes/:id/metrics?hours=1
interface MetricSeries {
  node_id: string;
  from: number; to: number;
  step: number;              // seconds per bucket (worker-side downsampling)
  points: Array<{
    ts: number;
    cpu: number;
    mem_percent: number;
    disk_percent: number;
    rx_rate: number;
    tx_rate: number;
    load1: number;
    net_in: number;
    net_out: number;
  }>;
}
```

**降采样规则（Worker 必须实现）：**
`hours <= 6` → 原始行。否则分桶为至多 **360** 个点：
`step = ceil(hours*3600/360)`，`ts = (ts/step)*step`，取值取平均
（`net_in`/`net_out` 使用 MAX，因为它们是累计计数器）。

---

## 4. HTTP API

基础路径为 `/api`。所有响应均为 JSON（`content-type: application/json`）。
错误使用 `{ "error": "<code>", "message": "<human readable>" }`，并搭配
相应的状态码。变更类操作成功时返回 `{ "ok": true, ... }`。

### 4.1 Agent 上报接收

#### `POST /api/v1/report`

请求头（二选一）：
- `Authorization: Bearer <agent-token>`
- `X-Node-Token: <agent-token>`

请求体：

```jsonc
{
  "name": "hk-01",                 // required on first contact, ignored afterwards
  "version": "1.0.0",              // agent version, informational
  "ts": 1760000000,                // optional; server time is used when absent
  "host": {                        // optional, captured once and stored in tags/region
    "os": "Ubuntu 24.04",
    "arch": "x86_64",
    "region": "HK",
    "cpu_model": "AMD EPYC 7K62 48-Core Processor",  // optional hardware identity
    "cpu_cores": 4                                     // logical cores
  },
  "metrics": { /* MetricSample */ },   // required
  "pings": [                            // optional
    { "name": "cloudflare", "type": "tcp", "target": "1.1.1.1:443",
      "value": 12.3, "ok": 1 }
  ]
}
```

`ts` 允许 Agent 把缓冲的采样按采集时刻上报。
它会被钳制在 **当前时间 − 7 天 … 当前时间 + 1 小时**；超出范围的值会替换为
服务器时钟。该行按 `(node_id, ts)` 做 upsert，因此重复发送同一
时间戳会覆盖而不是产生重复行。

每次上报还会把**请求来源地址**（`CF-Connecting-IP`，缺失时回退
`X-Forwarded-For` 的第一段）写入 `nodes.ip` —— Agent 是从被监控主机主动拨出的，
所以这个地址就是该主机的公网出口 IP，**无需改 Agent、也无需重装**。
地址变化时会覆盖旧值；取不到地址时保持原值不动。
该字段由摄取路径独占写入，**不接受** `PATCH /api/admin/nodes/:id` 修改 ——
手工设的值会被下一次上报静默覆盖。

**月度流量累计。** Agent 上报的 `net_in` / `net_out` 是自启动以来的累计值，
不能直接当作月度用量（长期运行的服务器会远超计费周期）。摄取路径用
**上一次采样的正增量**累加出 `traffic_month_in` / `traffic_month_out`：
主机重启会把计数器归零，因此只累加正向差值，否则会算出负数或严重虚高；
首报没有基线，贡献为 0；跨月（`traffic_month` 变化）时计数清零重来。
仪表盘的「剩余流量」= 配额 − 本月已用，`traffic_both` 决定是否把上行计入
（默认计入，多数服务商如此）。

`host.cpu_model` / `host.cpu_cores` 同样由摄取路径写入
（`nodes.host_info`，迁移 `0004_host_info.sql`），经校验后随
`NodeSummary.host` 下发（`{cpu_model, cpu_cores}`，`null` 表示尚未上报）。
缺失字段不会清除旧值；Agent 各平台尽力采集（Linux 读 `/proc/cpuinfo`，
Windows 读 CIM/注册表，macOS/BSD 读 `sysctl`），采不到就省略。

`200` 响应：

```json
{
  "ok": true,
  "node_id": "…",
  "server_time": 1760000000,
  "interval": 30,
  "pings": [
    { "id": "…", "name": "cloudflare", "type": "tcp",
      "target": "1.1.1.1:443", "interval": 60 }
  ]
}
```

语义：
- 令牌查找通过 `sha256(token)` 与 `nodes.token_hash` 比对。
- **自动注册**：如果令牌未知，且 `allow_auto_register`
  （设置项，默认 `false`）为开，则创建新节点。否则返回 `401`。
  *注意：* 专用的 `POST /api/admin/nodes` 始终会签发令牌；Agent
  通常配置为使用管理员签发的令牌。
- 写入一行 `metrics`，更新 `nodes.latest/online/last_seen`，
  并为 `name+target` 匹配到任务的探测插入 `ping_records`
  （未知探测会按该节点自动创建为 `ping_tasks`）。
- 令牌错误时返回 `401 {"error":"unauthorized"}`。
- 请求体格式错误时返回 `400 {"error":"bad_request"}`。

### 4.2 公开读取 API（无需认证）

| Method | Path                        | Returns                                        |
| ------ | --------------------------- | ---------------------------------------------- |
| GET    | `/api/status`               | `PublicStatus`                                 |
| GET    | `/api/nodes`                | `{ nodes: NodeSummary[], status: PublicStatus }` |
| GET    | `/api/nodes/:id`            | `NodeDetail`                                   |
| GET    | `/api/nodes/:id/metrics`    | `MetricSeries` — 查询参数 `?hours=1`（1..168）  |
| GET    | `/api/nodes/:id/pings`      | `{ pings: Array<PingTaskSummary & { series: … }> }` |
| GET    | `/api/groups`               | `{ groups: Array<{ name: string; count: number }> }` |

`hidden = 1` 的节点会从 `/api/nodes` 中排除，并且在 `/api/status` 中既不计为在线
也不计为离线。它们仍可通过 `:id` 直接访问，但仅限管理员
（公开调用者会得到 `404`）。

### 4.3 认证 API

| Method | Path                 | Body                          | Notes                                        |
| ------ | -------------------- | ----------------------------- | -------------------------------------------- |
| POST   | `/api/auth/login`    | `{username, password}`        | 设置 `vpsdog_session` Cookie（HttpOnly、SameSite=Lax、Secure、7d） |
| POST   | `/api/auth/logout`   | —                             | 清除 Cookie 并删除会话                        |
| GET    | `/api/auth/me`       | —                             | `{user:{id,username,role}}` 或 `401`         |
| POST   | `/api/auth/password` | `{old_password,new_password}` | 需已认证                                      |

**初始化：** 如果 `users` 为空，使用 `admin` / 环境变量 `ADMIN_PASSWORD`
（wrangler secret）调用 `POST /api/auth/login` 会创建初始
管理员用户并登录。如果 `ADMIN_PASSWORD` 未设置，默认值为 `admin`。
首次响应必须包含 `"bootstrap": true`。

### 4.4 管理 API（会话 Cookie 或 `Authorization: Bearer <session-id>`）

**角色校验。** 每个 `/api/admin/*` 路由都要求已认证的会话。
变更类请求（`POST`、`PATCH`、`PUT`、`DELETE`）额外要求
`role === "admin"`，对 `viewer` 返回 `403 {"error":"forbidden"}`。
读取类请求（`GET`）对任何已认证用户开放。

| Method | Path                             | Purpose                                              |
| ------ | -------------------------------- | ---------------------------------------------------- |
| GET    | `/api/admin/nodes`               | 所有节点（含隐藏节点），外加 `token_hint`             |
| POST   | `/api/admin/nodes`               | 创建节点 → `{node, token}`（**明文令牌仅返回一次**）；可选 `price/traffic_gb/expires_at` |
| PATCH  | `/api/admin/nodes/:id`           | 更新 `name/group/region/tags/hidden/sort_order/price/traffic_gb/expires_at` |
| DELETE | `/api/admin/nodes/:id`           | 删除节点及其指标 / 探测数据                           |
| POST   | `/api/admin/nodes/:id/token`     | 轮换令牌 → `{token}`                                 |
| GET    | `/api/admin/pings?node_id=`      | 列出探测任务                                          |
| POST   | `/api/admin/pings`               | 创建探测任务                                          |
| PATCH  | `/api/admin/pings/:id`           | 更新                                                  |
| DELETE | `/api/admin/pings/:id`           | 删除                                                  |
| GET    | `/api/admin/settings`            | 完整设置对象                                          |
| PUT    | `/api/admin/settings`            | 部分更新                                              |
| GET    | `/api/admin/users`               | 列出用户（不含哈希）                                  |
| POST   | `/api/admin/users`               | `{username,password,role}`                           |
| DELETE | `/api/admin/users/:id`           | 删除（不能删除最后一个管理员 / 自己）                 |
| GET    | `/api/admin/audit?limit=100`     | 最近的审计记录行                                      |
| GET    | `/api/admin/overview`            | `{nodes, online, offline, metrics_rows, oldest_ts, d1_size}` |
| POST   | `/api/admin/notify/test`         | 用已配置的 Telegram Bot 发一条测试消息；未配置 → 400，发送失败 → 502 |

每次变更类管理调用都会写入一行 `audit_logs`。

### 4.4.1 Telegram 通知

定时触发器（`*/5 * * * *`）在保留期清理之后运行通知扫描（`runNotifyScan`）：

- **状态转换检测。** 节点的在线状态在扫描时根据 `last_seen` 推导，与
  `nodes.notified_offline`（迁移 `0003_telegram.sql`，通知器的「已告知管理员」
  状态，**不是**在线标志的副本）对比：
  `离线待报 = last_seen > 0 且离线且 notified_offline = 0`；
  `恢复待报 = 在线且 notified_offline = 1`。从未上报过的节点（`last_seen = 0`）保持沉默。
- **节点级开关。** `nodes.notify = 0`（迁移 `0006`，管理端勾选）的节点完全跳过扫描；
  全局 `tg_*` 设置仍然优先。
- **来源国别。** 每次上报从 Cloudflare 的 `request.cf.country`（免费）记录
  `nodes.country`，供仪表盘显示国旗，不做任何外部 GeoIP 查询。
- **去重与重试。** 每次离线只发一条、每次恢复只发一条；发送失败时标志不变，
  下一个 tick 重试。恢复通知关闭时恢复仍会清零标志，否则过期的标志会吞掉下一次离线告警。
- **消息格式。** Telegram `parse_mode=HTML`，站点名 / 节点名 / 分组 / IP 均经过转义。

### 4.5 静态资源

Worker 通过 `ASSETS` 绑定提供构建后的 SPA。`run_worker_first` 为
`true`，因此 Worker 渲染 HTML 外壳（用于注入 `custom_head`）；
静态资源仍由该绑定提供。任何不在 `/api` 之下、且
不匹配文件的 `GET` 都会回退到 `index.html`（SPA 路由）。

部署配置位于**仓库根目录**的 `wrangler.toml`（Cloudflare 的
「Deploy to Cloudflare」按钮只读取仓库根目录的配置，因此它不能放在
`worker/` 子目录里）：

```toml
name = "vps-dog"
main = "worker/src/index.ts"

[[d1_databases]]
binding = "DB"
database_name = "vps-dog"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"   # provisioned by the button
migrations_dir = "worker/migrations"

[assets]
directory = "web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true
```

数据库迁移必须用 **binding 名（`DB`）** 而不是数据库名来执行，这样即使
使用者把数据库命名成别的名字也依然可用：

```bash
wrangler d1 migrations apply DB --remote
```

---

## 5. 认证细节

- **密码哈希**：`pbkdf2$<iterations>$<salt-b64>$<hash-b64>`，使用
  PBKDF2-SHA256、100_000 次迭代、16 字节盐值、32 字节密钥，经由 WebCrypto
  （`crypto.subtle.deriveBits`）。校验使用常量时间比较。
- **会话 Cookie**：名称为 `vpsdog_session`；值为 `sessions.id`。
  TTL 为 7 天。注销会删除该行。
- **Agent 令牌**：32 个随机字节 → hex（64 字符）。仅以
  `sha256` hex 存储。`token_hint` = 前 8 个字符，用于展示。
- **CORS**：`OPTIONS /api/*` 返回 204，并带
  `Access-Control-Allow-Origin: <request Origin or *>`、
  `Access-Control-Allow-Headers: content-type, authorization, x-node-token`、
  `Access-Control-Allow-Methods: GET,POST,PATCH,PUT,DELETE,OPTIONS`、
  `Access-Control-Allow-Credentials: true`。
  所有 `/api/*` 响应都会回显 CORS 头。
- **限流**：作用于 `/api/auth/login`：每个 IP 最多 10 次尝试 / 5 分钟，
  通过 isolate 上的内存 `Map` 实现（尽力而为，已在文档中说明）。

---

## 6. Agent 协议（Go）

Agent 是单个静态二进制文件，无运行时依赖，小于 8 MB。

**配置** —— `agent.yaml`（可选；命令行参数 / 环境变量可覆盖）：

```yaml
server: https://vps-dog.example.workers.dev   # env VPSDOG_SERVER
token:  "<64 hex chars>"                       # env VPSDOG_TOKEN
name:   "hk-01"                                # env VPSDOG_NAME
interval: 30                                   # seconds, server may override
tls_skip_verify: false
```

优先级：命令行参数 > 环境变量 > 配置文件 > 内置默认值。

**参数：** `-c <path>`（默认 `/etc/vps-dog/agent.yaml`）、`-server`、`-token`、
`-name`、`-interval`、`-once`、`-version`、`-install`、`-uninstall`。

**采集**（`internal/collector`）—— 以 Linux 为主，在其他操作系统上优雅降级
（返回零值，绝不崩溃）：
- CPU % —— 两次采样之间 `/proc/stat` 总计值的差值。
- 内存 / swap —— `/proc/meminfo`。
- 磁盘 —— 对 `/` 调用 `syscall.Statfs`（上报根文件系统）。
- 网络 —— `/proc/net/dev` 的累计字节数（跳过 `lo`）；速率 = 差值 / 经过时间。
- TCP/UDP socket 数量 —— `/proc/net/tcp`、`/proc/net/tcp6`、`/proc/net/udp`。
- 进程数 —— `/proc` 下数字条目（PID 目录）的个数。
- 在线时长 —— `/proc/uptime`。
- 负载 —— `/proc/loadavg`。

**延迟探测**（`internal/probe`）：
- `icmp` —— 以 root 运行时使用原始 ICMP echo，否则 `exec` `ping -c 1 -W 2`。
- `tcp` —— `net.DialTimeout("tcp", target, 3s)`，延迟 = 连接耗时。
- `http` —— 以 5 s 超时 `GET` 该 URL；延迟 = 首字节时间；
  `ok` = 状态码 < 400。

**循环：** 采集 → 探测服务器返回的任务 → POST JSON →
从响应中读取 `interval` 并休眠（钳制在 10..3600 s）。
网络出错时，按指数退避重试（1s → 2s → … → 最大 60s），
并保留最后一次已知的上报间隔。日志以 `[vps-dog]` 前缀输出到 stdout。

**另外必须提供：**
- `agent/install.sh` —— 一行命令安装脚本
  （`curl -fsSL .../install.sh | bash -s -- -s <server> -t <token>`），写入
  `/etc/vps-dog/agent.yaml`；有 systemd 时写 `/etc/systemd/system/vps-dog.service`
  并启用 + 启动它，**没有 systemd 时**（Docker 容器、LXC 模板）改为 `nohup`
  后台启动，PID 写 `/run/vps-dog.pid`、日志写 `/var/log/vps-dog.log`。
  需要 root，但**不要求命令带 `sudo`** —— 脚本自行判断并提权。
- `agent/build.sh` + `agent/build.ps1` —— 交叉编译 linux/amd64、linux/arm64、
  linux/armv7、darwin/amd64、darwin/arm64、windows/amd64 到 `dist/`。
- `go.mod` 模块路径 `github.com/vps-dog/agent`，Go 1.22+，**零外部
  依赖**（仅标准库），以便离线构建。

---

## 7. 前端（React SPA）

**技术栈：** Vite + React 19 + TypeScript + `react-router-dom` v7 +
`@tanstack/react-query` v5 + `echarts`（直接引入，包装在一个小的
`<Chart>` 组件中 —— 不要使用 `echarts-for-react`）+ 通过
`@tailwindcss/vite` 使用 Tailwind CSS v4。

**路由**

| Path              | Page          | Contents                                                                 |
| ----------------- | ------------- | ------------------------------------------------------------------------ |
| `/`               | `Dashboard`   | 状态条（在线 / 离线 / 总数、站点名称）、节点卡片网格、分组筛选、搜索、10 s 自动刷新 |
| `/node/:id`       | `NodeDetail`  | 大型 CPU / MEM / DISK 仪表、负载 + 在线时长 + 流量瓦片、ECharts 时间序列（CPU/MEM、网络速率、负载）、带迷你图的探测表格、1h/6h/24h/7d 范围切换 |
| `/admin`          | `AdminLogin`  | 未认证时显示登录表单                                                       |
| `/admin/nodes`    | `AdminNodes`  | 表格：新增 / 编辑 / 删除 / 轮换令牌 / 切换隐藏 / 排序。创建或轮换令牌后弹出对话框，一次性展示明文令牌**与可直接粘贴执行的安装命令**（`curl … | bash -s -- -s <origin> -t <token> -n <name> [-r <region>]`，`origin` 取自 `window.location.origin`；命令**不带 `sudo`**，由 `install.sh` 自行按需提权） |
| `/admin/pings`    | `AdminPings`  | 探测任务 CRUD                                                             |
| `/admin/settings` | `AdminSettings`| 站点设置表单                                                              |
| `/admin/users`    | `AdminUsers`  | 用户 CRUD                                                                 |
| `/admin/audit`    | `AdminAudit`  | 审计日志表格                                                              |

**设计语言**（这是首要要求 ——「界面简洁美观」）：
- 深色优先，但也提供真正的浅色主题。默认跟随 `prefers-color-scheme`，
  可被覆盖；持久化在 `localStorage` 的 `vpsdog.theme` 下。
- 配色 —— 深色：背景 `#05111f`，表面 `#08192b`，次级表面 `#0d2033`，
  边框 `#15395e`，文本 `#e8f0f8`，弱化 `#7d93ab`，强调（蓝）`#0092ff`，
  成功（青绿）`#1cf8ba`，警告 `#f5a524`，危险 `#f0506e`。
  浅色：背景 `#f4f7fb`，表面 `#ffffff`，次级表面 `#eef3f9`，边框 `#d7e3ef`，
  文本 `#0a1b2b`，弱化 `#5b7186`，强调 `#0074cc`，成功 `#0d9b76`，
  警告 `#b45309`，危险 `#d92d4b`。
  两套主题共用同一组色相（深海军蓝 + 青绿），切换主题只改明度、不改身份。
- 语义色分工固定：**下行 / 接收 = 成功色（青绿）**，**上行 / 发送 = 强调色（蓝）**，
  环形图、折线图、图例与指标条一律遵守；磁盘与负载沿用警告 / 危险色。
- 圆角 2xl 卡片、1px 边框、无重阴影、充足留白，
  所有数字使用 tabular-nums、150 ms 微妙过渡。
- 在线 = 脉动的绿点；离线 = 灰点。
- 仪表盘的每台服务器是一张**可折叠**卡片：头部（状态点 / 名称 / 状态徽章 / 折叠箭头）、
  元信息行（IP · 运行时长 · 系统 · 最后上报）、三栏主体（指标条 | 流量折线 | 上下行环形 + 协议占比）、
  以及底部的今日 / 近 24 小时 / 总流量与「查看详情」。**折叠状态下不请求该节点的历史接口**，
  展开才按当前时间窗拉取。
- 时长与相对时间（`duration` / `relativeTime`）接受 `lang` 参数，中文输出
  `16天` / `4分钟前`，英文输出 `16d` / `4m ago`；调用处必须传入当前语言。
- 响应式：小于 640 px 单列，小于 1024 px 两列，之上三列及以上。管理表格在移动端
  横向滚动。节点卡片的三栏主体在 1280 px 以下折为单列。
- 图表：除一条淡淡的水平线外无网格线，平滑曲线，
  面积渐变填充，十字准星提示框。
- i18n：`zh-CN` 与 `en`，从 `navigator.language` 自动检测，页头
  可切换，持久化在 `localStorage` 的 `vpsdog.lang` 下。所有 UI 文案都
  经过一个极小的 `t()` 辅助函数（`src/lib/i18n.ts`）—— 组件中不得硬编码中文 / 英文。

**开发代理：** `vite.config.ts` 将 `/api` 代理到 `http://127.0.0.1:8787`
（`wrangler dev`），因此 `pnpm dev` 提供可用的全栈开发闭环。

**构建产物：** `web/dist`（由 Worker 的资源绑定消费）。

---

## 8. 验证要求

每位协作者都必须留下一个**可运行**的检查，并报告确切的
命令 + 观察到的结果：

| Owner          | Must pass                                                          |
| -------------- | ------------------------------------------------------------------ |
| worker-backend | 在 `worker/` 内运行 `pnpm install && pnpm typecheck && pnpm test` —— 使用 `@cloudflare/vitest-pool-workers` 的 vitest 覆盖：健康检查、登录初始化、Agent 上报 → 节点变为在线、指标历史降采样、管理节点 CRUD、401 路径。 |
| web-frontend   | 在 `web/` 内运行 `pnpm install && pnpm build` —— 零 TS 错误，产出 `dist/index.html`。 |
| go-agent       | `go vet ./... && go build ./...`，以及针对本地 mock 运行 `go run . -once`，或运行 `-version`。 |
| docs-devops    | 所有文件齐备，CI YAML 可解析，链接可达。                            |

Lead 在宣布目标完成前运行最终的端到端检查（`wrangler dev` + 真实 Agent 上报）。
