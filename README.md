# VPS-DOG

<p align="center">
  <b>轻量级自托管服务器监控工具，完全运行在 Cloudflare 免费额度之上。</b><br>
  <sub>秉承 <a href="https://github.com/komari-monitor/komari">Komari</a> 与 <a href="https://github.com/nezhahq/nezha">Nezha</a> 的理念 —— 但面板无需 VPS，无需数据库服务器，也无需 Docker。</sub>
</p>

<p align="center">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white">
  <img alt="D1" src="https://img.shields.io/badge/Database-D1-F38020?logo=cloudflare&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="Go" src="https://img.shields.io/badge/Agent-Go-00ADD8?logo=go&logoColor=white">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-green">
</p>

---

## 动机

传统面板（Nezha、Komari、Uptime Kuma）需要一台服务器来托管面板，还需要在它旁边配一个数据库。VPS-DOG 把整个控制面搬到 **Cloudflare Workers + D1** 上，因此面板成本为 **每月 0 美元**，没有需要打补丁的服务器，而且默认就是全球分布式部署。你自己的机器上只需运行一个 **约 6 MB 的 Go 二进制文件**，零依赖。

```
┌──────────────┐   HTTPS POST /api/v1/report   ┌───────────────────────────┐
│   Go agent   │ ────────────────────────────► │  Cloudflare Worker (Hono) │
│  (your VPS)  │ ◄──────────────────────────── │  + D1 (SQLite at edge)    │
└──────────────┘   {ok, interval, pings[]}     └─────────────┬─────────────┘
                                                            │ static assets
                                                ┌───────────▼─────────────┐
                                                │  React SPA (Workers     │
                                                │  Static Assets)         │
                                                └─────────────────────────┘
```

## 功能

- **零成本控制面** —— Cloudflare Workers 免费额度 + D1 免费额度（5 GB）。
- **一行命令安装 Agent** —— `curl … | bash -s -- -s <server> -t <token>`。
- **实时指标** —— CPU、内存、Swap、磁盘、网络速率与累计流量、TCP/UDP 套接字、进程数、在线时长、负载。
- **延迟探测任务** —— ICMP / TCP / HTTP，由服务端调度、Agent 执行。
- **网站可用性监控（Uptime）** —— 直接由 Worker 检测网址存活性，即使服务器全宕机也能照常工作。添加网址时自动请求一次并把返回的状态码回填为「期望状态码」，支持 `2xx` 类、精确码或 `200,204` 列表，因此「接口返回 401 才算正常」这类站点也能正确判定。提供可用率、延迟与检测历史。
- **Telegram 通知** —— 节点离线 / 恢复、网站监控异常 / 恢复时推送消息，Bot Token 与 Chat ID 在后台设置里配置，一键发送测试消息。
- **美观的响应式仪表盘** —— 深色与浅色主题、实时图表、分组筛选、搜索、10 秒自动刷新，手机也能正常使用。
- **中英文界面** —— 自动检测，可随时切换。
- **多用户管理** —— PBKDF2-SHA256 密码哈希、HttpOnly cookie 会话、服务端强制校验的 `admin` / `viewer` 角色，以及审计日志。
- **公开的 JSON API** —— 可在其上构建自己的状态页或机器人。
- **自动保留策略** —— 定时触发器清除过期指标与探测结果；节点一旦静默即被标记为离线。
- **Agent 无外部依赖** —— 纯 Go 标准库，交叉编译覆盖 7 种平台/架构组合。

## 快速开始

### 一键部署到 Cloudflare

点下面的按钮，Cloudflare 会自动把你的副本克隆到你的 GitHub 账号，创建并绑定 **D1 数据库**、执行数据库迁移，然后完成部署：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/heshang2011/vps-dog)

部署过程中会要求你填写：

| 项目 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD` | 首次登录用的 `admin` 密码。**建议现在就改掉默认值。** |

部署完成后打开 Cloudflare 给出的 `https://<你的项目名>.<子域>.workers.dev`，进入 `/admin` 登录即可。

> 首次登录会自动创建管理员账号（用户名 `admin`，密码即上一步填写的值）。登录后请立刻在 `/admin/users` 中修改密码。

<details>
<summary>手动部署（不想用一键按钮）</summary>

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog

pnpm install
npx wrangler login

pnpm db:ensure                          # 创建/绑定 D1 并把真实 database_id 写回 wrangler.toml
npx wrangler secret put ADMIN_PASSWORD  # 初始管理员密码
npx wrangler d1 migrations apply DB --remote

pnpm build && pnpm run deploy
```

> `pnpm db:ensure` 是幂等的：库里已有同名数据库就直接绑定，没有才创建。想先看它打算做什么，用 `node scripts/ensure-d1.mjs --check`。
>
> 更习惯用仪表盘？也可以在 Cloudflare 仪表盘中创建 D1 数据库，再把它的 ID 粘贴到根目录的 `wrangler.toml`。

</details>

> **把仓库连到 Git（Workers Builds）而不是点按钮？** 这条路**不会**替你创建 D1 数据库 —— 这一步由仓库的 `build` 脚本在 Cloudflare 构建环境里自动完成（建库 → 绑定 → 建表），本地执行时跳过。在 Worker 的 **Settings → Build** 里确认 **Build command** 是 `pnpm install && pnpm build` 即可；**Deploy command** 保持默认的 `npx wrangler deploy` 或设为 `pnpm run deploy` 都能工作。细节见[部署指南 §0.5](docs/DEPLOYMENT.md)。

### 2. 添加节点

在 `/admin/nodes` 中 → **Add node** → 复制令牌（仅显示**一次**）。

### 3. 安装 Agent

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | bash -s -- -s https://<你的项目名>.<子域>.workers.dev -t <TOKEN> -n hk-01
```

节点会在约 10 秒内出现在仪表盘上。

<details>
<summary>手动安装</summary>

```bash
# download the binary for your arch from GitHub Releases
sudo mkdir -p /etc/vps-dog
sudo tee /etc/vps-dog/agent.yaml >/dev/null <<'EOF'
server: https://vps-dog.<you>.workers.dev
token:  "<TOKEN>"
name:   "hk-01"
interval: 30
EOF

sudo tee /etc/systemd/system/vps-dog.service >/dev/null <<'EOF'
[Unit]
Description=VPS-DOG monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/vps-dog -c /etc/vps-dog/agent.yaml
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now vps-dog
journalctl -u vps-dog -f
```
</details>

## 目录结构

| 路径 | 说明 |
| --- | --- |
| [`wrangler.toml`](wrangler.toml) | Worker 的部署配置（位于仓库根目录，供一键部署按钮读取） |
| [`worker/`](worker) | Cloudflare Worker：Hono API、D1 访问层、定时任务、vitest 测试套件 |
| [`web/`](web) | React 19 + Vite + Tailwind v4 SPA（仪表盘 + 管理后台） |
| [`agent/`](agent) | Go Agent：采集器、探测任务、安装脚本、交叉编译脚本 |
| [`docs/`](docs) | [部署](docs/DEPLOYMENT.md)、[API 参考](docs/API.md)、[架构](docs/ARCHITECTURE.md)、[贡献指南](docs/CONTRIBUTING.md)、[接口契约](docs/CONTRACT.md) |

## 文档

- **[部署指南](docs/DEPLOYMENT.md)** —— 从零到上线面板，另含自定义域名、备份与成本说明。
- **[HTTP API 参考](docs/API.md)** —— 每个端点，附 `curl` 示例。
- **[架构](docs/ARCHITECTURE.md)** —— 各组件如何协作、数据模型与设计决策。
- **[贡献指南](docs/CONTRIBUTING.md)** —— 开发环境搭建、代码风格、发布流程。
- **[接口契约](docs/CONTRACT.md)** —— 已冻结的跨组件规范。

## 开发

```bash
pnpm install

# terminal 1 — Worker API on http://127.0.0.1:8787
pnpm db:migrate:local
pnpm dev:worker

# terminal 2 — Vite dev server with /api proxied to the Worker
pnpm dev

# checks
pnpm typecheck
pnpm test
```

Agent：

```bash
cd agent
go run . -once        # print a sample payload without sending
go build -o dist/vps-dog .
```

## 公开状态 API

```bash
curl https://vps-dog.<you>.workers.dev/api/status
curl https://vps-dog.<you>.workers.dev/api/nodes
curl https://vps-dog.<you>.workers.dev/api/uptime
curl "https://vps-dog.<you>.workers.dev/api/nodes/<id>/metrics?hours=24"
```

完整接口见 [`docs/API.md`](docs/API.md)。

## 安全

- 密码以 PBKDF2-SHA256 存储（100 000 次迭代，每用户独立盐值）。
- 会话是 `HttpOnly; SameSite=Lax; Secure` cookie 中的 32 字节随机 ID。
- Agent 令牌仅以 SHA-256 哈希存储，明文只显示一次。
- 登录受限流保护（每 IP 每 5 分钟 10 次尝试）。
- 每次管理员变更都会写入审计日志。

发现漏洞？请通过私密安全公告反馈，而不要提交公开 issue。

## 许可证

[MIT](LICENSE)
