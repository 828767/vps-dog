# 架构

## 目标与非目标

**目标**

1. 整个控制平面跑在 Cloudflare 免费额度上 —— 面板不需要 VPS。
2. Agent 保持为单个静态二进制文件，零运行时依赖。
3. 所有数据存在一个 D1（SQLite）数据库中，Worker 可直接访问。
4. 提供快速、简洁、在手机上也能用的仪表盘。
5. 代码量足够小，一个人一个晚上就能读完整个代码库。

**非目标**

- 高分辨率指标的长期保留（D1 不是时间序列数据库）。
- 容器／进程级的内省（那是 Netdata 和 Beszel 的职责）。
- 通用告警流水线（规则引擎、多通道 webhook）—— Telegram 离线通知已内置
  （见下文），更复杂的场景仍是扩展点，不属于核心。

## 组件图

```
                        ┌──────────────────────────────────────────┐
   agent (Go)           │            Cloudflare Worker             │
 ┌──────────────┐       │  ┌────────────────────────────────────┐  │
 │ collector    │       │  │ Hono router                        │  │
 │  /proc,statfs│       │  │  /api/v1/report   ← agent ingest   │  │
 ├──────────────┤       │  │  /api/status|nodes|groups (public) │  │
 │ probe        │  POST │  │  /api/auth/*      (sessions)       │  │
 │  icmp/tcp/http│─────►│  │  /api/admin/*     (CRUD + audit)   │  │
 ├──────────────┤       │  └──────────────┬─────────────────────┘  │
 │ client       │◄──────│                 │                        │
 │  backoff     │  JSON │  ┌──────────────▼─────────────────────┐  │
 └──────────────┘       │  │ db.ts — D1 prepared statements     │  │
                        │  └──────────────┬─────────────────────┘  │
                        │  ┌──────────────▼─────────────────────┐  │
                        │  │ cron.ts — retention + offline sweep│  │
                        │  └──────────────┬─────────────────────┘  │
                        │                 ▼                        │
                        │           D1 (SQLite)                    │
                        │  ┌────────────────────────────────────┐  │
                        │  │ ASSETS → web/dist (React SPA)      │  │
                        │  └────────────────────────────────────┘  │
                        └──────────────────────────────────────────┘
                                        ▲
                                        │ fetch /api/*
                                  ┌─────┴─────┐
                                  │  Browser  │
                                  └───────────┘
```

## 请求链路

### Agent 上报（热路径）

1. `POST /api/v1/report` 到达，携带 `Authorization: Bearer <token>`。
2. Worker 对令牌做哈希（`SHA-256`），再查找 `nodes.token_hash`。
   该表很小（每台服务器一行），因此这是一次顺序扫描；如果将来要监控
   上千台主机，请加索引。
3. 对指标采样做校验与强制转换：每个数值字段默认取 `0`，
   因此不完整的载荷永远不会在数据库中产生 `null`。
4. 向 `metrics` 写入一行（主键 `(node_id, ts)`），并在同一批次中更新
   反范式（冗余存储）的 `nodes.latest` / `online` / `last_seen` 列。
5. 任何 `name + target` 未知的探测结果，都会为该节点新建一行 `ping_tasks`，
   因此运维人员只需修改 Agent 配置就能开始测量。
6. 响应中携带服务器的 `report_interval` 与该节点启用的探测任务，
   Agent 会在下次上报之前执行它们。

第 4 步是刻意反范式（冗余存储）的：仪表盘每张卡片只读一行节点数据，
而不必对 `metrics` 跑相关子查询。

### 仪表盘读取

`GET /api/nodes` 执行一条 `SELECT … FROM nodes ORDER BY sort_order, created_at`，
解析 `latest` JSON blob，计算百分比，并返回网格所需的全部数据。
`GET /api/nodes/:id/metrics` 运行时间序列查询，并在服务端做降采样（见下文）。

## 数据模型

| 表 | 用途 | 增长量级 |
| --- | --- | --- |
| `nodes` | 每台服务器一行：身份、令牌哈希、分组、反范式（冗余存储）的最新状态 | O(servers) |
| `metrics` | 每个节点每次上报一行 | O(servers × reports/day × retention) |
| `ping_tasks` | 探测任务定义 | O(servers × probes) |
| `ping_records` | 每次探测执行一行 | O(probes × executions/day × retention) |
| `users` / `sessions` | 管理员账号与 cookie 会话 | tiny |
| `settings` | 键／值形式的站点配置 | tiny |
| `audit_logs` | 每一次管理员变更 | tiny |

`metrics` 使用 `WITHOUT ROWID` 与复合主键 `(node_id, ts)`；按节点和时间做范围
扫描是仅索引扫描，这正是历史接口需要的。`ts` 上的二级索引用于支持保留期删除。

### 时间与单位

- 每个时间戳都是 Unix 纪元**秒**（`INTEGER`）。
- 字节数单位为**字节**；速率单位为**字节每秒**；百分比取值为 **0–100**。
- `net_in` / `net_out` 是自启动以来的累计计数器，因此降采样器用 `MAX`
  聚合它们，而对仪表值取平均。

## 降采样

以 30 秒间隔渲染 24 小时意味着 2 880 个点 —— 画不下，也传不动。
规则如下（接口契约 §3.1）：

```
hours <= 6   → raw rows
hours  > 6   → step = ceil(hours * 3600 / 360)
               bucket key = (ts / step) * step
               AVG(cpu, mem, disk, rx_rate, tx_rate, load1)
               MAX(net_in, net_out)
```

360 个点的上限使最大响应保持在约 40 KB 以内，同时在一周的跨度上仍能分辨
5 分钟级别的特征。

## 保留期与离线清理任务

定时触发器（`*/5 * * * *`）运行 `scheduled()`：

1. `DELETE FROM metrics WHERE ts < now - retention_days*86400`
2. `DELETE FROM ping_records WHERE ts < now - ping_retention_days*86400`
3. `DELETE FROM sessions WHERE expires_at < now`
4. **Telegram 通知扫描**（`notify.ts` 的 `runNotifyScan()`，见下文）

这里刻意**没有**「标记离线」这一步。节点的在线状态在读取时由 `last_seen`
推导（`db.ts` 中的 `isOnline()`），因此存储一个标志位会造出第二个事实来源，
可能与第一个不一致 —— 而且每五分钟就要付一次全表 `UPDATE` 的代价。
API 响应中的 `online` 字段始终是计算出来的，从不从某一列读取。

删除操作分批执行，因为 D1 拒绝绑定参数超过 100 个的语句。
同一段代码通过 `POST /api/admin/sweep` 暴露，用于手动执行与测试。

## Telegram 通知

在线状态从不落库（§7），但**通知**需要一个跨 tick 的事实：这条离线告警
发出过没有？`nodes.notified_offline`（迁移 `0003_telegram.sql`）就是这个
发送状态——它不是在线标志的第二份拷贝，而是「管理员已被知会」的记录：

- `离线待报 = last_seen > 0 且离线且 notified_offline = 0` → 发送 🔴，置 1。
- `恢复待报 = 在线且 notified_offline = 1` → 发送 🟢，置 0（即使恢复通知
  已关闭也清零，否则过期的标志会吞掉下一次离线告警）。
- 发送失败时标志不变，下一个 tick（5 分钟后）重试；Telegram 打烊不会
  永久吞掉一条告警，只会推迟它。
- 从未上报过的节点（`last_seen = 0`）永远沉默——「没见过」不等于「离线」。

扫描放在清理任务之后、同一个 cron 里；通知未配置或两种事件都关闭时，
一次 `getSettings` 读取即返回。`POST /api/admin/notify/test` 走同一条
发送路径，供设置页验证配置。

## 安全模型

| 关注点 | 决策 |
| --- | --- |
| 密码 | PBKDF2-SHA256，100 000 次迭代，16 字节随机盐值，32 字节派生密钥，常量时间比较 |
| 会话 | 32 个随机字节，服务端存储在 `sessions` 中，`HttpOnly; SameSite=Lax; Secure` cookie，TTL 7 天 |
| Agent 令牌 | 32 个随机字节（64 位十六进制）；只存储 `SHA-256`。明文仅展示一次，并保留 `token_hint`（前 8 个字符）供 UI 使用 |
| CSRF | 会话 cookie 上的 `SameSite=Lax` 才是实际有效的控制手段。CORS 会带着凭据回显任意请求的 `Origin`（这样面板才能在自定义域名下工作），这意味着预检请求*不是* CSRF 防御 —— 不要依赖 content-type 检查 |
| 暴力破解 | 登录限制为 10 次尝试／5 分钟／IP（按 isolate 内存计数 —— 尽力而为，已记录在案） |
| 枚举探测 | 隐藏节点对匿名调用者返回 404，且不计入公开统计 |
| 可审计性 | 每一次管理员变更都记录操作者、动作、目标、IP |

令牌哈希是最关键的一环：泄露的 D1 备份无法让攻击者冒充 Agent。

## 设计取舍

**为什么选 D1，而不是 Workers KV / R2 / Durable Objects？**
该工作负载是关系型的、查询密集的（范围扫描、聚合、用于计数的 join）。
D1 是带真正查询规划器的 SQLite，因此 `GROUP BY`/`AVG` 降采样就在数据旁边完成。
KV 没有查询能力；R2 读取小行数据的成本不低；
Durable Objects 属于过度设计，且按请求计费。

**为什么采用拉取式探测模型？**
服务器在每次上报时告诉 Agent 要运行哪些探测任务（响应中的 `pings`）。
新增探测任务无需重启 Agent，也无需向被监控主机建立入站连接 ——
当机器位于 NAT 之后时这一点很重要。

**为什么反范式（冗余存储）`nodes.latest`？**
仪表盘的读取频率远高于写入频率。每节点一行让主页面只需一次索引扫描，
而不是 N 次相关子查询。

**为什么不用 ORM？**
表结构一共九张表。`db.ts` 中手写的预编译语句更易于审计，
并且产生的 SQL 与 D1 实际执行的完全一致 —— 不会有意外的 N+1。

**为什么 `run_worker_first = true`？**
HTML 外壳必须经过 Worker，这样 `custom_head` 设置才能在 `</head>` 之前注入。
静态资源仍由绑定直接从边缘提供，并且设置查询只对 `text/html` 响应发生 ——
JS 与 CSS 请求只花费一次内部 fetch，且不产生 D1 查询。

## 扩展点

- **更多告警通道。** Telegram 的发送与状态转换检测都在 `notify.ts`，与
  cron 的耦合只有一个函数调用；加 webhook / Slack / 邮件通道时把
  `sendTelegramMessage` 换成通道列表即可。基于阈值的告警（CPU 超载等）
  需要另一套待报状态，可仿照 `notified_offline` 的做法。
- **更多采集项。** 给 `MetricSample` 加一个字段，给 `metrics` 加一列，给
  `MetricSeries` 加一条序列。降采样表是另一处需要改动的地方。
- **状态页。** `/api/status` 与 `/api/nodes` 无需认证；任何地方的静态页面
  都可以渲染它们。
- **多地区。** `nodes.region` 与 `nodes.group_name` 已经存在；在仪表盘里加一个
  地区筛选只是 UI 改动。

## 验证策略

| 层次 | 检查方式 |
| --- | --- |
| Worker | 用 `vitest` 与 `@cloudflare/vitest-pool-workers` 对真实的（内存中）D1 运行真实 Worker，覆盖上报接收 → 仪表盘 → 历史 → 管理员 CRUD → 认证失败 |
| SPA | CI 中执行 `tsc --noEmit` + `vite build` |
| Agent | CI 中执行 `go vet`、`go build` 以及交叉编译矩阵；`-once` 无需网络即可打印真实载荷 |
| 集成 | Lead 在本地运行 `wrangler dev`，用 `curl` 提交一次上报，并确认该节点在 `/api/nodes` 中显示为在线 |
