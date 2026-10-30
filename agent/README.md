# VPS-DOG agent

一个静态 Go 二进制文件，向 VPS-DOG worker 上报主机指标与延迟探测结果。
仅使用标准库 —— **零外部依赖**，因此它完全离线也能构建和运行。

协议参考：[`docs/CONTRACT.md`](../docs/CONTRACT.md) §4.1 与 §6。

---

## 构建

```bash
go build -o vps-dog .                 # current platform
./build.sh 1.0.0                      # cross-compile everything into dist/
```

```powershell
go build -o dist\vps-dog.exe .        # Windows
.\build.ps1                           # cross-compile everything into dist\
```

`build.sh` / `build.ps1` 在 `CGO_ENABLED=0` 与
`-ldflags "-s -w -X main.Version=<version>"` 下生成：

| 目标平台        | 产物                         |
| --------------- | ---------------------------- |
| linux/amd64     | `vps-dog-linux-amd64`        |
| linux/arm64     | `vps-dog-linux-arm64`        |
| linux/arm (v7)  | `vps-dog-linux-armv7`        |
| linux/386       | `vps-dog-linux-386`          |
| darwin/amd64    | `vps-dog-darwin-amd64`       |
| darwin/arm64    | `vps-dog-darwin-arm64`       |
| windows/amd64   | `vps-dog-windows-amd64.exe`  |

---

## 配置

把 [`agent.example.yaml`](agent.example.yaml) 复制到 `/etc/vps-dog/agent.yaml`
（权限 `0600`），并填写 `server` 与 `token`。

```yaml
server: "https://vps-dog.example.workers.dev"
token: "0123456789abcdef…"     # 64 hex chars from the dashboard
name: "hk-01"
interval: 30
tls_skip_verify: false
```

优先级：**命令行参数 > 环境变量 > 配置文件 > 内置默认值**。

| 设置项            | 参数                | 环境变量                |
| ----------------- | ------------------- | ----------------------- |
| 配置文件路径      | `-c <path>`         | `VPSDOG_CONFIG`         |
| `server`          | `-server`           | `VPSDOG_SERVER`         |
| `token`           | `-token`            | `VPSDOG_TOKEN`          |
| `name`            | `-name`             | `VPSDOG_NAME`           |
| `region`          | `-region`           | `VPSDOG_REGION`         |
| `interval`        | `-interval`         | —                       |
| `tls_skip_verify` | `-tls-skip-verify`  | `VPSDOG_TLS_SKIP_VERIFY` |

`VPSDOG_DEBUG=1` 会打印非 Linux 系统上所用平台辅助命令的原始输出。

---

## 安装

### 一行命令

```bash
curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh \
  | bash -s -- -s https://vps-dog.example.workers.dev -t <token>
```

`install.sh` 会检测架构、下载匹配的发布二进制文件、写入 `/etc/vps-dog/agent.yaml`，
然后按环境选择启动方式：

| 环境 | 行为 | 管理方式 |
| --- | --- | --- |
| 有 systemd | 写入 `/etc/systemd/system/vps-dog.service` 并启用 | `systemctl status vps-dog`、`journalctl -u vps-dog -f` |
| 无 systemd（Docker 容器、LXC 模板等） | `nohup` 后台启动，PID 写入 `/run/vps-dog.pid`，日志写 `/var/log/vps-dog.log` | `kill $(cat /run/vps-dog.pid)`、`tail -f /var/log/vps-dog.log` |

**命令里不要加 `sudo`**：脚本需要 root，但会自己判断 —— 已经是 root 就直接执行，
非 root 且系统有 sudo 时才用它提权。容器往往恰好是「root 但没有 sudo」，
此时 `curl … | sudo bash` 会在脚本运行前就失败。

无 systemd 时进程**不会自动重启**（没有 init 系统可依赖）。容器场景请把
`/usr/local/bin/vps-dog -c /etc/vps-dog/agent.yaml &` 写进 entrypoint，或用 supervisor 托管。

加 `-u` 重新运行即可卸载，两种模式都会停掉。

### 内置安装脚本

如果二进制文件已经在主机上：

```bash
sudo vps-dog -install -server https://vps-dog.example.workers.dev -token <token> -name hk-01
sudo vps-dog -uninstall            # keeps /etc/vps-dog/agent.yaml
sudo vps-dog -uninstall -purge     # removes the config directory and the binary
```

这两条要求 root **和**运行中的 systemd；不满足时会明确报错退出，不会装到一半就停下。
容器等无 systemd 环境请改用上面的 `install.sh`。

---

## 命令行参数

| 参数                | 默认值                     | 说明                                                               |
| ------------------- | -------------------------- | ------------------------------------------------------------------ |
| `-c <path>`         | `/etc/vps-dog/agent.yaml`  | 要加载的配置文件（文件不存在不算错误）。                           |
| `-server <url>`     | `http://127.0.0.1:8787`    | Worker 基础 URL。                                                  |
| `-token <token>`    | —                          | 由管理员 API 签发的 Agent 令牌。                                   |
| `-name <name>`      | hostname                   | 节点显示名称，首次联系时发送。                                     |
| `-region <label>`   | —                          | 地区标签，例如 `HK`。                                              |
| `-interval <secs>`  | `30`                       | 上报间隔秒数（钳制在 10..3600）。                                  |
| `-tls-skip-verify`  | `false`                    | 接受无效的 TLS 证书（自签名 worker）。                             |
| `-once`             | `false`                    | 采集一次，把 JSON 载荷打印到 stdout，然后退出。                    |
| `-version`          | `false`                    | 打印版本并退出。                                                   |
| `-install`          | `false`                    | 写入 systemd 服务单元与配置，然后启用并启动服务。                  |
| `-uninstall`        | `false`                    | 停止、禁用并移除 systemd 服务单元。                                |
| `-purge`            | `false`                    | 配合 `-uninstall` 使用：同时删除配置目录与二进制文件。             |

`-once` 从不访问网络，并且在所有平台上都能用 —— 它是查看 Agent 会上报什么内容
最快的方式：

```console
$ vps-dog -once
{
  "name": "hk-01",
  "version": "1.0.0",
  "host": { "os": "Ubuntu 24.04", "arch": "x86_64", "region": "HK" },
  "metrics": { "cpu": 12.5, "mem_used": 1073741824, ... }
}
```

---

## 工作原理

```
collect → probe the tasks the server asked for → POST /api/v1/report → sleep interval
```

- **循环。** 首次运行不发送任何探测任务：服务器的响应会告诉 Agent 该运行哪些
  探测任务、以及多久上报一次。响应中的 `interval` 会被限制（钳制）在 10..3600 秒；
  失败时 Agent 按 1 秒 → 2 秒 → 4 秒 → … → 60 秒退避并持续重试。
  `SIGINT`/`SIGTERM` 会干净地关闭它。
- **Linux 采集。** `/proc/stat`（CPU 增量）、`/proc/meminfo`、
  `/proc/net/dev`、`/proc/net/tcp{,6}`、`/proc/net/udp{,6}`、`/proc/uptime`、
  `/proc/loadavg`、`/proc` 的进程数，以及针对根文件系统的
  `syscall.Statfs("/")`。`net_in`/`net_out` 是自启动以来所有
  非 `lo` 接口的累计值；`rx_rate`/`tx_rate` 是相对已用时间的增量，
  在第一次采样时为 `0`。
- **其他平台。** 优雅降级为零值 —— 绝不崩溃。在 Windows 上，
  Agent 通过 PowerShell 读取内存、磁盘、在线时长、进程数、套接字数量、累计
  网络字节数与 CPU 负载（使用 .NET 的 CIM/WMI，并有注册表和性能计数器
  回退方案，因为某些加固或沙箱环境中 CIM 不可用）；在 macOS 和 BSD 上则使用
  `sysctl`、`vm_stat`、`df` 和 `ps`。负载仅在操作系统提供时可用。
- **探测任务**（`icmp`、`tcp`、`http`）各自都有超时，并上报 `ok` 为
  `1`/`0`，失败时 `value = -1`。`icmp` 在有权限时使用原始套接字，
  否则回退到系统的 `ping` 二进制文件。
- **日志。** 每一行都带 `[vps-dog]` 前缀。

---

## 验证

```bash
gofmt -l .          # prints nothing
go vet ./...
go build ./...
go run . -once      # prints a valid JSON payload on any platform
```
