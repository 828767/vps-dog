# 安全策略

## 支持的版本

仅 Worker 与 Agent 的最新发布版本会收到安全修复。

| 组件 | 是否支持 |
| --- | --- |
| Worker / SPA（最新标签） | ✅ |
| Agent（最新标签） | ✅ |
| 较旧的标签 | ❌ |

## 报告漏洞

**请勿提交公开 issue。**

请使用 GitHub 的[私密漏洞报告](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)：进入仓库的 **Security** 标签页 → **Report a vulnerability**。

请一并提供：

- 受影响的组件与版本/提交，
- 问题描述及其影响，
- 复现步骤或概念验证，
- 任何建议的缓解措施。

我们会在 72 小时内给出初步回复。除非你希望保持匿名，否则我们会在发布说明中致谢。

## 威胁模型

VPS-DOG 是自托管监控面板。与安全相关的资产包括：

1. **Agent 令牌** —— 授予为某个节点提交指标的权限。
2. **管理员会话** —— 授予对节点、用户与设置的完全控制权。
3. **D1 数据库** —— 包含密码哈希、会话 ID 与指标历史。

范围内：

- `worker/src/auth.ts` 中的身份认证与会话处理。
- 每条 `/api/admin/*` 路由的鉴权。
- `/api/v1/report` 的输入校验（Agent 令牌属于半可信：它可能从被入侵的主机泄露）。
- 通过 SQL、HTML（`custom_head`）或 SPA 发起的注入。
- 通过无限制的请求体或行数增长发起的拒绝服务。

范围外：

- 需要 Cloudflare 账号已被入侵才能实施的攻击。
- 公开的 `/api/status` 与 `/api/nodes` 端点本身可见 —— 隐藏节点可通过 `hidden` 标志实现。
- 内存中的登录限流是按 isolate 生效的；这是已记录的、有意为之的尽力取舍。

## 运维方加固清单

- [ ] 在首次登录**之前**设置强 `ADMIN_PASSWORD` 密钥。
- [ ] 首次登录后立即修改初始化密码。
- [ ] 为纵深防御，在 `/api/auth/login` 上添加 Cloudflare WAF 限流规则。
- [ ] 若被监控主机被入侵，轮换 Agent 令牌（`/admin/nodes` → 轮换）。
- [ ] 定期查看 `/admin/audit`。
- [ ] 定期导出 D1 数据 —— 数据库丢失就意味着历史数据丢失。

## 内置防护

- PBKDF2-SHA256、100 000 次迭代、每用户随机盐值、常量时间比较。
- Agent 令牌仅以 SHA-256 哈希存储；明文仅在创建时显示一次。
- 会话为 32 字节随机值，可在服务端吊销，`HttpOnly; SameSite=Lax; Secure`。
- 登录限流为每 IP 每 5 分钟 10 次尝试。
- 所有 SQL 均使用带绑定参数的预编译语句。
- 每次管理员变更都会写入审计日志。
- 响应中带有 `X-Content-Type-Options: nosniff`。
