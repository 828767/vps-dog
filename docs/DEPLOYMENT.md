# 部署指南

以下内容假设使用全新的 Cloudflare 账号。总配置时间约 10 分钟。免费额度下的持续开销：**$0**。

---

## 0. 前置要求

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | ≥ 20 | 构建 SPA 并运行 Wrangler |
| pnpm | ≥ 9 | 工作区包管理器 |
| Wrangler | ≥ 4 | 部署 Worker 并管理 D1 |
| Go | ≥ 1.22 | 仅当你自行构建 Agent 时需要（预编译二进制文件在 Releases 页面） |

```bash
node -v && pnpm -v && npx wrangler --version
```

---

## 0. 一键部署（推荐）

点下面的按钮，Cloudflare 会自动：把你的副本克隆到你的 GitHub 账号 → 创建并绑定 **D1 数据库** → 执行迁移 → 构建并部署。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/heshang2011/vps-dog)

配置页只需填写 `ADMIN_PASSWORD`（初始管理员密码）。完成后打开 Cloudflare 给出的 `https://<项目名>.<子域>.workers.dev`，进入 `/admin` 登录。

> 这个按钮读取的是**仓库根目录**的 `wrangler.toml`。Cloudflare 会创建一个真实的 D1 数据库，并把它的 `database_id` 回填到你克隆出来的那份配置里 —— 所以仓库里的占位值不需要你手动改。

**不想用一键按钮？** 从 §1 开始手动部署。

---

## 0.5 Workers Builds（Git 集成）部署

如果你不是点按钮，而是把 GitHub 仓库直接连到 **Workers & Pages → Create → Workers → Connect to Git**，有一点必须先知道：

> Workers Builds **不会**为你的仓库创建 D1 数据库。"Deploy to Cloudflare" 按钮会创建，但只在**它克隆出来的那份副本**里创建。你自己连 Git 时没有这一步，于是 `wrangler deploy` 读到的仍然是仓库里的占位 `database_id`，直接失败：

> ```
> D1 binding 'DB' references database '<id>' which was not found. [code: 10181]
> ```

仓库内置了补上这一步的脚本 [`scripts/ensure-d1.mjs`](../scripts/ensure-d1.mjs)：部署前先查一次账号里的 D1，**有同名库就绑定，没有就创建**，然后把真实的 `database_id` 写回 `wrangler.toml`。它只看 id 是否真的能在账号里解析出来，不看格式 —— 从别人的 fork 里带过来的合法 UUID 同样会被当成"缺失"并修复。脚本是幂等的，反复构建不会重复建库。

**关键：建库和建表都由 `build` 这一步完成。**

`pnpm build` 在 Cloudflare 的构建环境里（检测到 `WORKERS_CI` 时）会额外做三件事；本地跑则完全跳过、不联网：

1. **断言 `web/dist/index.html` 存在** —— 缺了就让构建直接失败，而不是部署一个空白前端
2. **`ensure-d1`** —— 账号里没有 `vps-dog` 就创建，有就绑定，并把真实的 `database_id` 写回 `wrangler.toml`
3. **`d1 migrations apply DB --remote`** —— 建表。少了这一步，库是空的，所有 `/api/*` 都会 500

因为 `build` 必定在 `deploy` 之前执行，所以配置可以很简单：

| 设置项 | 值 |
| --- | --- |
| Build command | `pnpm install && pnpm build` |
| Deploy command | `pnpm run deploy`（或保持默认的 `npx wrangler deploy`） |

不显式配置也能跑通，但配上最稳：`pnpm run deploy` 会再做一次 `ensure-d1` 和迁移（两者都幂等），相当于给 build 阶段加一层兜底。

四点注意：

- 写 **`pnpm run deploy`**，不要写 `pnpm deploy` —— 后者在部分 pnpm 版本里会被解析成 pnpm 的内置命令。
- 如果这个 Cloudflare 登录下挂了**多个账号**，请在 **Settings → Build → Variables and Secrets** 里补上 `CLOUDFLARE_ACCOUNT_ID`（值见 `npx wrangler whoami`）。非交互环境下 Wrangler 无法替你选择账号。
- 一键按钮会提示你填 `ADMIN_PASSWORD`，Workers Builds 不会。部署完成后到 **Settings → Variables and Secrets** 添加同名 **Secret** 即可，无需重新部署；留空则初始化密码为 `admin`。
- 构建环境里的这些 D1 操作需要该次构建的凭据带 **D1 读写权限**。若权限不足，`ensure-d1` 会在日志里警告但**不阻断构建**，随后 `wrangler deploy` 会用仓库里的占位 `database_id` 报出明确错误 —— 而不是静默部署一个坏站点。


### 构建配置不对时看到的现象

Build command 和 Deploy command 是两件独立的事，各漏一半会得到两种完全不同的症状 —— 对号入座即可：

| 现象 | 缺了哪一步 | 修复 |
| --- | --- | --- |
| 打开站点看到深色的 **"The VPS-DOG frontend has not been built yet"** 页面，但 `/api/*` 是通的 | Build command 没跑，`web/dist` 不存在，静态资源绑定是空的 | Build command 设为 `pnpm install && pnpm build` |
| 页面正常（或仍是上面的降级页），但**所有** `/api/*` 返回 500 `{"error":"internal_error","message":"Internal server error"}` | 迁移没跑。用 `npx wrangler tail` 会看到 `D1_ERROR: no such table: settings` | Deploy command 设为 `pnpm run deploy` |
| 两者同时出现 | Deploy command 用了默认的 `npx wrangler deploy`，两个步骤都跳过了 | 两条都按上面设置 |

> 那个降级页**不等于** Worker 没起来，也不等于数据库没建 —— 它只表示 `env.ASSETS` 里没有内容。反过来，API 报 `no such table` 也不代表绑定错了：`npx wrangler d1 list` 里看这张库的 `num_tables` 是 0，就是迁移没跑。

---

## 1. 克隆并构建前端

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog
pnpm install
pnpm build          # emits web/dist — the Worker serves this as static assets
```

> 根目录 `wrangler.toml` 的 `[assets]` 绑定指向 `web/dist`。该目录缺失时，
> Wrangler/Miniflare **会启动失败**，因此在运行 `wrangler dev` 或
> `wrangler deploy` 之前先构建 SPA。（Worker 自带的回退页面
> 仅覆盖绑定完全缺失的情况，例如在测试中。）

---

## 2. 创建 D1 数据库

最省事的方式是让脚本一次性完成"查库 / 建库 / 改写配置"：

```bash
npx wrangler login
pnpm db:ensure          # 需要多账号时：CLOUDFLARE_ACCOUNT_ID=<id> pnpm db:ensure
```

它会把真实的 `database_id` 写进根目录的 [`wrangler.toml`](../wrangler.toml)，替换掉 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。想先看看它会做什么而不实际改动，加 `--check`：`node scripts/ensure-d1.mjs --check`。

<details>
<summary>手动创建（等价步骤）</summary>

```bash
npx wrangler d1 create vps-dog
```

Wrangler 会打印类似下面的内容：

```toml
[[d1_databases]]
binding = "DB"
database_name = "vps-dog"
database_id = "8f3c1e2a-...."
```

把真实的 `database_id` 粘贴到根目录的 [`wrangler.toml`](../wrangler.toml) 中，替换 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

</details>

---

## 3. 应用迁移

```bash
npx wrangler d1 migrations apply DB --remote
```

这会创建 `nodes`、`metrics`、`ping_tasks`、`ping_records`、`users`、`sessions`、`settings` 和 `audit_logs`，并写入默认设置。

> 这里用的是 **binding 名 `DB`**，不是数据库名。两者在你自己部署时通常一致，但用 binding 名更稳妥 —— 如果你把数据库命名成别的名字，命令依然有效。

本地开发使用相同的命令并加上 `--local`（见 §7）。

---

## 4. 设置管理员密码

```bash
npx wrangler secret put ADMIN_PASSWORD
# paste a strong password when prompted
```

如果跳过此步骤，默认的初始化密码是 `admin` —— 首次登录后请立即在 `/admin/users` 中**修改它**。初始化账号会在针对空 `users` 表的首次成功登录尝试时惰性创建。

---

## 5. 部署

```bash
npx wrangler deploy
```

输出：

```
Uploaded vps-dog (1.23 sec)
  https://vps-dog.<your-subdomain>.workers.dev
  Schedule: */5 * * * *
```

打开该 URL，点击 **Admin**，使用 `admin` 和你的密码登录。

---

## 6. 添加第一个节点

1. 进入 `/admin/nodes` → **Add node**。
2. 为它设置名称（`hk-01`）、分组（`production`）和地区（`HK`）。
3. **立即复制令牌** —— 它只显示一次。服务端只存储其 SHA-256 哈希。
4. 安装 Agent：

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | bash -s -- -s https://vps-dog.<your-subdomain>.workers.dev -t <TOKEN> -n hk-01
```

5. `journalctl -u vps-dog -f` 应显示每 30 秒一次的上报，并且该节点会在仪表盘上变绿。

### 配置延迟探测

在 `/admin/pings` 中，为某个节点添加探测任务：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| type | `tcp` | `icmp`、`tcp` 或 `http` |
| target | `1.1.1.1:443` | `icmp` → 主机，`tcp` → `host:port`，`http` → 完整 URL |
| interval | `60` | 秒 |

Agent 会在下次上报时获取新探测任务，并立即开始测量。

---

## 7. 本地开发

```bash
# terminal 1 — Worker API
pnpm db:migrate:local
pnpm dev:worker

# terminal 2 — SPA with /api proxied to 127.0.0.1:8787
pnpm dev
```

打开 http://localhost:5173。初始化登录在本地同样可用。

让 Agent 指向本地 Worker：

```bash
cd agent
go run . -server http://127.0.0.1:8787 -token <TOKEN> -name dev -once   # dry run
go run . -server http://127.0.0.1:8787 -token <TOKEN> -name dev        # loop
```

---

## 8. 自定义域名

1. Cloudflare 仪表盘 → **Workers & Pages** → `vps-dog` → **Settings** → **Domains & Routes**。
2. **Add** → **Custom domain** → `monitor.example.com`。
3. 如果该域名区域托管在 Cloudflare，DNS 与证书会自动配置。

之后更新各 Agent 的 `server:` 值，然后执行 `sudo systemctl restart vps-dog`。

---

## 9. 备份

D1 导出：

```bash
npx wrangler d1 export vps-dog --remote --output backup-$(date +%F).sql
```

恢复到新数据库：

```bash
npx wrangler d1 create vps-dog-restore
npx wrangler d1 execute vps-dog-restore --remote --file backup-2026-01-01.sql
```

由于指标数据量很大，通常每晚导出 `nodes`、`users`、`settings`、`ping_tasks` 以及一个滚动窗口的 `metrics` 就足够了：

```bash
npx wrangler d1 execute vps-dog --remote --command \
  "SELECT * FROM nodes" --json > nodes.json
```

---

## 10. 调优与运维

| 设置（`/admin/settings`） | 默认值 | 作用 |
| --- | --- | --- |
| `report_interval` | 30 s | Agent 的上报频率。值越小则数据行越多、D1 写入越多。 |
| `offline_after` | 90 s | 节点被显示为离线前的静默秒数。 |
| `retention_days` | 30 | 早于该时长的指标会被 5 分钟一次的定时任务删除。 |
| `ping_retention_days` | 7 | 同上，作用于探测结果。 |
| `custom_head` | empty | 注入到 SPA 外壳 `</head>` 之前的原始 HTML。 |

**需要注意的免费额度限制。** 免费方案下 D1 允许每天约 5 M 行读取、100 k 行写入。一个每 30 秒上报一次的节点每天写入 2 880 行 `metrics`，**再加上每次上报中每个已配置探测任务的一行 `ping_records`** —— 因此配置三个探测任务的节点每天大约写入 11 500 行。按每个节点三个探测任务计算，每天 100 k 行大约可支持 8 个节点；或者把 `report_interval` 提高到 60 s，即可翻倍。

手动维护：

```bash
# force the retention/offline sweep right now
curl -X POST https://vps-dog.<you>.workers.dev/api/admin/sweep -b "vpsdog_session=<id>"

# tail live logs
npx wrangler tail
```

---

## 11. 升级

```bash
git pull
pnpm install && pnpm build
pnpm db:migrate:remote && pnpm exec wrangler deploy
```

Agent 与 v1 协议向前和向后兼容；升级它们是可选的。重新运行 `install.sh`（或替换二进制文件并执行 `systemctl restart vps-dog`）即可更新。

---

## 12. 常见问题

| 症状 | 原因 / 解决办法 |
| --- | --- |
| 节点一直离线 | `server:` URL 错误、令牌错误，或出站 HTTPS 被阻断。检查 `journalctl -u vps-dog -n 50`。 |
| Agent 日志中出现 `401 unauthorized` | 令牌已被轮换，或节点已被删除。在 `/admin/nodes` 中签发新令牌。 |
| 仪表盘一片空白 | 部署前没有构建 `web/dist`。运行 `pnpm build` 并重新部署。 |
| `/admin` 提示密码错误 | 在用户创建之后才设置 `ADMIN_PASSWORD` 密钥 —— 该密钥只用于初始化*第一个*用户。可在 D1 控制台执行 `DELETE FROM users;` 重置，或直接添加一个用户。 |
| `no such table` | 迁移被应用到了错误的 database id。请重新检查根目录的 `wrangler.toml`。 |
| 部署时报 `[code: 10181]`（database not found）或 `[code: 10021]`（invalid database_id） | `wrangler.toml` 里的 `database_id` 指向了本账号不存在的库 —— 常见于从别人的 fork 或一键部署副本里带来的 id。执行 `pnpm db:ensure`，它会创建/绑定本账号的库并改写配置。Workers Builds 场景见 §0.5。 |
| Workers Builds 构建成功，但页面报 `no such table` | 建表迁移没有执行。把 Deploy command 设为 `pnpm run deploy`（见 §0.5）。 |
| Workers Builds 报 `More than one account available but unable to select one in non-interactive mode` | 该登录下有多个账号，构建环境无法交互选择。在 **Settings → Build → Variables and Secrets** 里添加 `CLOUDFLARE_ACCOUNT_ID`。 |
| 新节点上图表为空 | 历史数据至少需要两次上报；等一分钟。 |
| `D1_ERROR: too many SQL variables` | 只有在你 fork 并修改批次大小时才可能出现；内置清理任务会分批写入。 |
| `*.workers.dev` 返回 `error code: 1101`，但自定义域名一切正常 | 这是 **workers.dev 入口本身**的问题，请求压根不会到达 Worker：`npx wrangler tail` 里看不到这些请求，且同一子域下的其他 Worker 会一并报错（子域级故障）。与本项目的代码和配置无关，挂上自定义域名即可，无需改仓库。 |
