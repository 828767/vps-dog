# 为 VPS-DOG 贡献代码

感谢你抽出时间参与贡献。本文档涵盖开发流程、我们关注的约定，以及发布是如何进行的。

## 环境准备

```bash
git clone https://github.com/heshang2011/vps-dog.git
cd vps-dog
pnpm install
```

你需要 Node ≥ 20、pnpm ≥ 9，以及 —— 仅当你改到 Agent 时才需要 —— Go ≥ 1.22。

### 运行整套服务

```bash
# 1. local D1 + Worker API on http://127.0.0.1:8787
pnpm db:migrate:local
pnpm dev:worker

# 2. SPA with /api proxied to the Worker, on http://localhost:5173
pnpm dev
```

在 `/admin` 用 `admin` / `admin` 登录（或你在根目录 `.dev.vars` 里设置的
任意 `ADMIN_PASSWORD`，可从 `.dev.vars.example` 复制）。

### 检查

```bash
pnpm typecheck        # worker + web
pnpm test             # worker vitest suite
cd web && pnpm build  # production SPA build
cd agent && go vet ./... && go build ./...
```

CI 在每次 push 与拉取请求时都会运行这些检查。

## 仓库约定

- **接口契约是 [`docs/CONTRACT.md`](CONTRACT.md)。** 表结构、DTO、路由
  与载荷结构都在那里冻结。改动跨组件接口意味着在同一个 PR 中修改契约，
  并更新所有消费方。
- **时间戳**是 Unix 纪元**秒**（整数）。**字节**就是字节。
  **百分比**取值为 0–100。不要用字符串表示浮点数，不要用毫秒。
- **SQL** 位于 `worker/src/db.ts` 与迁移中。路由绝不根据用户输入拼接 SQL
  字符串 —— 始终使用带 `.bind()` 的预编译语句。
- **类型**通过 `worker/src/types.ts` 共享；SPA 在
  `web/src/lib/types.ts` 中镜像它们（它无法跨构建边界导入）。
- **Agent 中不新增运行时依赖。** 它必须保持纯标准库，这样才能离线构建
  并保持在约 8 MB 以下。
- **UI 文案**统一走 `web/src/lib/i18n.ts` 中的 `t()` —— `zh-CN` 与 `en`
  两份字典必须一起更新。绝不要硬编码用户可见的文本。

## 代码风格

### TypeScript

- `strict: true`；导出的签名中避免使用 `any`。
- 优先把小的纯函数放在 `util.ts` / `format.ts` 中，而不是在组件里写内联逻辑。
- 每个路由都要校验其输入，并返回文档中约定的错误结构。
- 错误结构为 `{ error, message }` 并配上正确的状态码；绝不泄露堆栈信息。

### Go

- `gofmt` 干净（提交前执行 `gofmt -w .`）。
- 错误要带上上下文包装：`fmt.Errorf("collect cpu: %w", err)`。
- 采集器绝不能 panic：未知平台降级为零值。
- 用 `[vps-dog]` 前缀输出日志到 stdout；systemd 会捕获它。

### CSS / UI

- Tailwind v4，CSS 优先：主题令牌位于 `web/src/index.css` 的 `@theme` 下。
- 使用语义化工具类（`bg-surface`、`text-muted`、`border-border`），而不是在组件中
  写原始十六进制颜色值，这样两套主题都能正常工作。
- 每个新组件在浅色**和**深色模式下、以及在 375 px 宽度下都必须显示正常。

## 添加迁移

```bash
# create worker/migrations/0002_your_change.sql  (never edit an applied migration)
pnpm db:migrate:local
```

迁移按文件名顺序应用。在可行的情况下保持幂等
（`CREATE TABLE IF NOT EXISTS`、`INSERT OR IGNORE`）。

## 添加指标

1. 在 `docs/CONTRACT.md` §3 中把该字段加到 `MetricSample`。
2. 在新的迁移中添加该列，并把它加到 §2 的 `metrics` 中。
3. 在上报处理函数（`worker/src/routes/agent.ts`）中做强制转换。
4. 把它加入降采样器的 `AVG`/`MAX` 列表（`worker/src/db.ts`）。
5. 把它加到 `MetricSeries.points`，并在 `web/src/pages/NodeDetail.tsx` 中渲染。
6. 在 `agent/internal/collector/` 中采集它。

## 添加接口

1. 在 `docs/CONTRACT.md` §4 **和** `docs/API.md` 中记录它。
2. 在对应的 `worker/src/routes/*.ts` 文件中实现它。
3. 在 `worker/test/api.test.ts` 中写一个 vitest 用例，覆盖正常路径**和**
   未认证／未授权路径。
4. 在 `web/src/lib/api.ts` 中接上客户端调用，以及消费它的 UI。

## 提交信息

Conventional Commits 前缀，祈使语气：

```
feat(worker): add per-node token rotation
fix(web): keep the node grid from overflowing at 320px
docs: document the sweep endpoint
chore(ci): cache the pnpm store
```

保持 PR 聚焦。一个既改表结构又重做仪表盘的 PR 应该拆成两个 PR。

## 拉取请求检查清单

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] `cd web && pnpm build` 通过
- [ ] `cd agent && go vet ./... && gofmt -l .` 干净（如果你改到了 Agent）
- [ ] 接口有变更时已更新 `docs/CONTRACT.md`
- [ ] 新接口有测试和文档
- [ ] UI 改动已在两套主题和移动端宽度下验证

## 发布流程

1. 在根目录的 `package.json`、`worker/package.json`、
   `web/package.json` 和 `agent/version.go` 中提升 `version`。
2. `git tag v1.x.y && git push --tags`。
3. `release` workflow 会为所有目标交叉编译 Agent，并把二进制文件
   连同 `install.sh` 附加到 GitHub 发布中。
4. 在**仓库根目录**执行 `pnpm build && pnpm run deploy` 即可发布 Worker；SPA 会在同一次
   部署中上传（assets 绑定）。`deploy` 会先跑 `scripts/ensure-d1.mjs`，把 D1
   数据库补建/绑定到当前账号 —— 改了 `wrangler.toml` 里的 D1 相关内容后请连同它一起测试。
   （注意别写成 `pnpm deploy`，部分 pnpm 版本会把它当成内置命令。）

## 问题反馈

请附上：部署的版本、确切的 `curl` 或 UI 操作步骤、响应内容，以及
涉及 Worker 时的 `npx wrangler tail` 输出。安全相关问题请提交私有
安全公告，而不要开公开 issue。

## 许可证

参与贡献即表示你同意你的贡献按
[MIT License](../LICENSE) 授权。
