//go:build !linux

package collector

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

// This file implements the graceful-degradation path for every platform that
// is not Linux (contract §6: "graceful degradation on other OSes — return
// zeros, never crash"). Nothing here may panic, and every reader must return
// an error rather than bad data when its source is unavailable.
//
// The underlying sources are external commands, which are relatively
// expensive to spawn, so all of them are read through a short-lived cached
// snapshot: the eight readers Collect() invokes in one cycle share a single
// round of process spawns.

// ── cached platform snapshot ─────────────────────────────────────────────

type platformSnapshot struct {
	ok bool

	cpuTimes cpuTimes

	// hasCPUPercent is true when the platform reported an instantaneous CPU
	// load percentage instead of cumulative ticks.
	hasCPUPercent bool
	cpuPercent    float64

	mem    memInfo
	disk   struct{ used, total uint64 }
	net    struct{ rx, tx uint64 }
	tcp    int
	udp    int
	proc   int
	uptime uint64
	load   [3]float64

	cpuModel string
	cpuCores int

	osName string
}

var (
	snapMu sync.Mutex
	snap   platformSnapshot
	snapAt time.Time
)

// snapshotTTL is how long a snapshot stays valid. Collect() reads all of its
// sources back-to-back, so in practice one snapshot serves one full cycle.
const snapshotTTL = 1500 * time.Millisecond

func ensureSnapshot() platformSnapshot {
	snapMu.Lock()
	defer snapMu.Unlock()
	if snap.ok && time.Since(snapAt) < snapshotTTL {
		return snap
	}
	snap = readPlatformSnapshot()
	snap.ok = true
	snapAt = time.Now()
	return snap
}

// ── readers ──────────────────────────────────────────────────────────────

func readCPUTimes() (cpuTimes, error) {
	s := ensureSnapshot()
	if s.cpuTimes.total() == 0 {
		return cpuTimes{}, errUnavailable
	}
	return s.cpuTimes, nil
}

// platformCPUPercent reports an instantaneous CPU load percentage when the
// platform provides one directly (Windows). The bool is false when the shared
// /proc/stat-style delta logic should be used instead.
func platformCPUPercent() (float64, bool) {
	s := ensureSnapshot()
	if !s.hasCPUPercent {
		return 0, false
	}
	return s.cpuPercent, true
}

func readMemInfo() (memInfo, error) {
	s := ensureSnapshot()
	if s.mem.MemTotal == 0 {
		return memInfo{}, errUnavailable
	}
	return s.mem, nil
}

func readDiskRoot() (used, total uint64, err error) {
	s := ensureSnapshot()
	if s.disk.total == 0 {
		return 0, 0, errUnavailable
	}
	return s.disk.used, s.disk.total, nil
}

func readNetDev() (rx, tx uint64, err error) {
	s := ensureSnapshot()
	if s.net.rx == 0 && s.net.tx == 0 {
		return 0, 0, errUnavailable
	}
	return s.net.rx, s.net.tx, nil
}

func readSocketCounts() (tcp, udp int, err error) {
	s := ensureSnapshot()
	return s.tcp, s.udp, nil
}

func readProcessCount() (int, error) {
	s := ensureSnapshot()
	if s.proc == 0 {
		return 0, errUnavailable
	}
	return s.proc, nil
}

func readUptime() (uint64, error) {
	s := ensureSnapshot()
	if s.uptime == 0 {
		return 0, errUnavailable
	}
	return s.uptime, nil
}

func readLoad() (l1, l5, l15 float64, err error) {
	s := ensureSnapshot()
	return s.load[0], s.load[1], s.load[2], nil
}

func osName() string {
	if n := ensureSnapshot().osName; n != "" {
		return n
	}
	switch runtime.GOOS {
	case "windows":
		return "Windows"
	case "darwin":
		return "macOS"
	default:
		g := runtime.GOOS
		if g == "" {
			return "unknown"
		}
		return strings.ToUpper(g[:1]) + g[1:]
	}
}

// cpuModel returns the CPU model name, "" when unavailable.
func cpuModel() string {
	return ensureSnapshot().cpuModel
}

// cpuCores returns the logical core count, 0 when unavailable
// (the caller falls back to runtime.NumCPU).
func cpuCores() int {
	return ensureSnapshot().cpuCores
}

// errUnavailable marks a metric source that this platform cannot provide.
var errUnavailable = &unavailableError{}

// debugEnabled reports whether VPSDOG_DEBUG is set; it prints the raw output
// of the platform helper commands to stderr.
func debugEnabled() bool {
	v := strings.TrimSpace(os.Getenv("VPSDOG_DEBUG"))
	return v != "" && v != "0" && !strings.EqualFold(v, "false")
}

type unavailableError struct{}

func (*unavailableError) Error() string { return "metric unavailable on this platform" }

// ── per-OS snapshot readers ──────────────────────────────────────────────

func readPlatformSnapshot() platformSnapshot {
	switch runtime.GOOS {
	case "windows":
		return readWindowsSnapshot()
	case "darwin", "freebsd", "openbsd", "netbsd", "dragonfly":
		return readUnixSnapshot()
	default:
		// Unknown platform: stay silent and report zeros.
		return platformSnapshot{}
	}
}

// ── Windows ──────────────────────────────────────────────────────────────

// windowsScript emits one `key=value` line per metric.
//
// Every section is wrapped in try/catch and every metric has a layered
// fallback, because CIM/WMI is unavailable in some environments (hardened
// hosts, restricted tokens, sandboxed processes) while the .NET, registry and
// performance-counter APIs keep working.
const windowsScript = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Emit([string]$k, $v) {
  if ($null -ne $v -and "$v" -ne '') { "$k=$v" }
}

# ── memory: CIM, then the registry, then the memory performance counters ──
$total = 0; $free = 0; $swapTotal = 0; $swapFree = 0; $boot = $null
try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  if ($os) {
    $total = [int64]$os.TotalVisibleMemorySize * 1024
    $free  = [int64]$os.FreePhysicalMemory * 1024
    $swapTotal = ([int64]$os.TotalVirtualMemorySize - [int64]$os.TotalVisibleMemorySize) * 1024
    $swapFree  = ([int64]$os.FreeVirtualMemory - [int64]$os.FreePhysicalMemory) * 1024
    $boot = $os.LastBootUpTime
    Emit 'os_name' $os.Caption
  }
} catch {}
if ($total -le 0) {
  try {
    $mm = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management' -ErrorAction Stop
    if ($mm.TotalPhysicalMemory) { $total = [int64]$mm.TotalPhysicalMemory }
  } catch {}
}
if ($total -le 0) {
  try { $total = [int64](Get-Counter '\Memory\Commit Limit' -ErrorAction Stop).CounterSamples[0].CookedValue } catch {}
}
if ($free -le 0) {
  try { $free = [int64]((Get-Counter '\Memory\Available MBytes' -ErrorAction Stop).CounterSamples[0].CookedValue * 1MB) } catch {}
}
if ($swapTotal -le 0) {
  try {
    $limit     = [int64](Get-Counter '\Memory\Commit Limit'    -ErrorAction Stop).CounterSamples[0].CookedValue
    $committed = [int64](Get-Counter '\Memory\Committed Bytes' -ErrorAction Stop).CounterSamples[0].CookedValue
    $swapTotal = $limit - $total
    if ($swapTotal -lt 0) { $swapTotal = 0 }
    # Committed bytes beyond physical RAM are what actually sits in the pagefile.
    $used = $committed - $total
    if ($used -lt 0) { $used = 0 }
    if ($used -gt $swapTotal) { $used = $swapTotal }
    $swapFree = $swapTotal - $used
  } catch {}
}
if ($total -gt 0) {
  Emit 'mem_total' $total
  if ($free -le $total) { Emit 'mem_free' $free }
  Emit 'swap_total' $swapTotal
  if ($swapFree -le $swapTotal) { Emit 'swap_free' $swapFree }
}

# ── uptime: boot time from CIM, else tick counters, else oldest process ───
$uptime = 0
if ($boot) { $uptime = [int64]((Get-Date) - $boot).TotalSeconds }
if ($uptime -le 0) {
  try { $uptime = [int64]([Environment]::TickCount64 / 1000) } catch {}
}
if ($uptime -le 0) {
  # Windows PowerShell 5.1 has no TickCount64; the oldest accessible process
  # started within a second or two of boot.
  try {
    $oldest = Get-Process | Where-Object { $_.StartTime } |
              Sort-Object StartTime | Select-Object -First 1
    if ($oldest) { $uptime = [int64]((Get-Date) - $oldest.StartTime).TotalSeconds }
  } catch {}
}
if ($uptime -le 0) {
  try { $uptime = [int64]([Environment]::TickCount / 1000) } catch {}
}
Emit 'uptime' $uptime

# ── CPU identity: model name and logical core count ──────────────────────
try {
  $p = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
  if ($p) {
    Emit 'cpu_model' $p.Name
    if ([int]$p.NumberOfLogicalProcessors -gt 0) { Emit 'cpu_cores' ([int]$p.NumberOfLogicalProcessors) }
  }
} catch {}
if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) {
  try {
    $cv = Get-ItemProperty 'HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0' -ErrorAction Stop
    Emit 'cpu_model' $cv.ProcessorNameString
  } catch {}
  try { Emit 'cpu_cores' ([System.Environment]::ProcessorCount) } catch {}
}

# ── CPU: CIM load percentage, else the processor time counter ─────────────
$cpu = $null
try {
  $c = (Get-CimInstance Win32_Processor -ErrorAction Stop | Measure-Object -Property LoadPercentage -Average).Average
  if ($null -ne $c) { $cpu = [double]$c }
} catch {}
if ($null -eq $cpu) {
  try {
    $c = [double](Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue
    $cpu = [math]::Round($c)
  } catch {}
}
if ($null -ne $cpu) {
  $cpu = [int][math]::Max(0, [math]::Min(100, [math]::Round($cpu)))
  Emit 'cpu_load' $cpu
}

# ── process count ────────────────────────────────────────────────────────
try { Emit 'process' @([System.Diagnostics.Process]::GetProcesses()).Count } catch {}

# ── root disk: CIM, then System.IO.DriveInfo, then the C: PSDrive ─────────
$diskTotal = 0; $diskFree = 0
try {
  $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
  if (-not $d) {
    $d = Get-CimInstance Win32_LogicalDisk -ErrorAction Stop |
         Where-Object { $_.DriveType -eq 3 } | Select-Object -First 1
  }
  if ($d) { $diskTotal = [int64]$d.Size; $diskFree = [int64]$d.FreeSpace }
} catch {}
if ($diskTotal -le 0) {
  try {
    $di = New-Object System.IO.DriveInfo 'C'
    $diskTotal = [int64]$di.TotalSize
    $diskFree  = [int64]$di.AvailableFreeSpace
  } catch {}
}
if ($diskTotal -le 0) {
  try {
    $drv = Get-PSDrive -Name C -ErrorAction Stop
    $diskFree  = [int64]$drv.Free
    $diskTotal = [int64]$drv.Used + [int64]$drv.Free
  } catch {}
}
if ($diskTotal -gt 0) {
  Emit 'disk_total' $diskTotal
  if ($diskFree -le $diskTotal) { Emit 'disk_free' $diskFree }
}

# ── cumulative network bytes over non-loopback interfaces ────────────────
$rx = 0; $tx = 0
try {
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
    if ($nic.OperationalStatus -ne 'Up') { continue }
    $st = $nic.GetIPv4Statistics()
    $rx += [int64]$st.BytesReceived
    $tx += [int64]$st.BytesSent
  }
} catch {}
if ($rx -le 0 -and $tx -le 0) {
  try {
    $stats = Get-NetAdapterStatistics -ErrorAction Stop
    if ($stats) {
      $rx = [int64](($stats | Measure-Object -Property ReceivedBytes -Sum).Sum)
      $tx = [int64](($stats | Measure-Object -Property SentBytes -Sum).Sum)
    }
  } catch {}
}
if ($rx -gt 0 -or $tx -gt 0) {
  Emit 'net_in' $rx
  Emit 'net_out' $tx
}

# ── socket counts via netstat ────────────────────────────────────────────
try {
  $ns = netstat -an
  Emit 'tcp' @($ns | Select-String -Pattern '^\s*TCP\s' -AllMatches).Count
  Emit 'udp' @($ns | Select-String -Pattern '^\s*UDP\s' -AllMatches).Count
} catch {}

# ── OS name fallback ─────────────────────────────────────────────────────
if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) {
  try {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    $name = $cv.ProductName
    if ($cv.DisplayVersion) { $name = "$name $($cv.DisplayVersion)" }
    Emit 'os_name' $name
  } catch {}
}
`

func readWindowsSnapshot() platformSnapshot {
	var s platformSnapshot
	out, err := runWindowsScript(windowsScript, 20*time.Second)
	if debugEnabled() {
		fmt.Fprintf(os.Stderr, "[vps-dog] windows metric script: err=%v raw=%q\n", err, out)
	}
	if err != nil {
		return s
	}
	kv := parseKeyValues(out)

	if v := strings.TrimSpace(kv["os_name"]); v != "" {
		s.osName = v
	}
	if v := strings.TrimSpace(kv["cpu_model"]); v != "" {
		s.cpuModel = v
	}
	if n := kvUint(kv, "cpu_cores"); n > 0 {
		s.cpuCores = int(n)
	}
	s.mem.MemTotal = kvUint(kv, "mem_total")
	memFree := kvUint(kv, "mem_free")
	if memFree <= s.mem.MemTotal {
		s.mem.MemAvailable = memFree
	}
	s.mem.SwapTotal = kvUint(kv, "swap_total")
	swapFree := kvUint(kv, "swap_free")
	if swapFree <= s.mem.SwapTotal {
		s.mem.SwapFree = swapFree
	}

	diskTotal, diskFree := kvUint(kv, "disk_total"), kvUint(kv, "disk_free")
	if diskFree <= diskTotal {
		s.disk.total = diskTotal
		s.disk.used = diskTotal - diskFree
	}

	s.net.rx, s.net.tx = kvUint(kv, "net_in"), kvUint(kv, "net_out")
	s.uptime = kvUint(kv, "uptime")
	if p := kvUint(kv, "process"); p > 0 {
		s.proc = int(p)
	}
	s.tcp = int(kvUint(kv, "tcp"))
	s.udp = int(kvUint(kv, "udp"))

	// Windows exposes an instantaneous CPU load percentage rather than
	// cumulative ticks; collector.go consumes it directly.
	if strings.Contains(out, "cpu_load=") {
		s.hasCPUPercent = true
		s.cpuPercent = clampPercent(float64(kvUint(kv, "cpu_load")))
	}

	// Socket counts and load averages are not portably available here.
	return s
}

// ── Darwin / BSD ─────────────────────────────────────────────────────────

func readUnixSnapshot() platformSnapshot {
	var s platformSnapshot

	// CPU model: machdep.cpu.brand_string on macOS/`most` BSDs; empty when the
	// OID does not exist (the report just omits the field).
	if out, err := runCommand(5*time.Second, "sysctl", "-n", "machdep.cpu.brand_string"); err == nil {
		if m := strings.TrimSpace(out); m != "" {
			s.cpuModel = m
		}
	}
	// Logical core count.
	if out, err := runCommand(5*time.Second, "sysctl", "-n", "hw.ncpu"); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(out)); err == nil && n > 0 {
			s.cpuCores = n
		}
	}

	// Memory: sysctl hw.memsize (bytes).
	if out, err := runCommand(5*time.Second, "sysctl", "-n", "hw.memsize"); err == nil {
		if n, err := strconv.ParseUint(strings.TrimSpace(out), 10, 64); err == nil {
			s.mem.MemTotal = n
		}
	}
	// Swap: sysctl vm.swapusage → "total = 2048.00M  used = 12.00M  free = 2036.00M"
	if out, err := runCommand(5*time.Second, "sysctl", "-n", "vm.swapusage"); err == nil {
		s.mem.SwapTotal = parseSwapField(out, "total")
		if used := parseSwapField(out, "used"); used <= s.mem.SwapTotal {
			s.mem.SwapFree = s.mem.SwapTotal - used
		}
	}
	// Memory in use: vm_stat page counts (page size 4096 on Intel, 16384 on
	// Apple Silicon — derive it from the "page size of N bytes" header).
	if out, err := runCommand(5*time.Second, "vm_stat"); err == nil {
		if free := parseVMStatFree(out); free > 0 && free <= s.mem.MemTotal {
			s.mem.MemAvailable = free
		}
	}
	// Disk: df -k / (1024-byte blocks).
	if out, err := runCommand(5*time.Second, "df", "-k", "/"); err == nil {
		if used, total, ok := parseDF(out); ok {
			s.disk.used, s.disk.total = used, total
		}
	}
	// Load averages: sysctl vm.loadavg → "{ 1.23 1.45 1.67 }"; fall back to
	// parsing the classic `uptime` output.
	if out, err := runCommand(5*time.Second, "sysctl", "-n", "vm.loadavg"); err == nil {
		s.load = parseLoadAvg(out)
	}
	if s.load == [3]float64{} {
		if out, err := runCommand(5*time.Second, "uptime"); err == nil {
			s.load = parseUptimeLoad(out)
		}
	}
	// Process count: ps -A, minus the header line.
	if out, err := runCommand(5*time.Second, "ps", "-A"); err == nil {
		if n := len(strings.Split(strings.TrimSpace(out), "\n")) - 1; n > 0 {
			s.proc = n
		}
	}
	// Uptime: kern.boottime → "{ sec = 1700000000, usec = 0 } ...".
	if out, err := runCommand(5*time.Second, "sysctl", "-n", "kern.boottime"); err == nil {
		if boot, ok := parseBootTime(out); ok {
			if d := time.Since(boot); d > 0 {
				s.uptime = uint64(d.Seconds())
			}
		}
	}
	// OS name: sw_vers on macOS.
	name, _ := runCommand(5*time.Second, "sw_vers", "-productName")
	ver, _ := runCommand(5*time.Second, "sw_vers", "-productVersion")
	if n := strings.TrimSpace(name); n != "" {
		s.osName = strings.TrimSpace(n + " " + strings.TrimSpace(ver))
	}
	return s
}

// ── helpers ──────────────────────────────────────────────────────────────

// runCommand executes a command with a hard timeout and returns its stdout.
func runCommand(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// runWindowsScript runs a PowerShell script via -EncodedCommand.
//
// Passing a multi-line script through -Command is not safe: Go escapes
// embedded newlines as `\n` and PowerShell then sees a single mangled line.
// -EncodedCommand takes base64-encoded UTF-16LE, which avoids all shell
// quoting entirely.
//
// PowerShell 7 (`pwsh`) is preferred when present because its cmdlets are
// more capable, but the script is written to work on Windows PowerShell 5.1
// as well, which is what a stock Windows Server provides.
func runWindowsScript(script string, timeout time.Duration) (string, error) {
	encoded := base64.StdEncoding.EncodeToString(utf16LE(script))

	candidates := []string{"powershell"}
	if _, err := exec.LookPath("pwsh"); err == nil {
		candidates = []string{"pwsh", "powershell"}
	}

	var firstErr error
	for _, exe := range candidates {
		out, err := runCommand(timeout, exe, "-NoProfile", "-NonInteractive",
			"-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded)
		if err == nil {
			return out, nil
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	if firstErr == nil {
		firstErr = errUnavailable
	}
	return "", firstErr
}

// utf16LE encodes s as UTF-16 little endian, which is what -EncodedCommand
// expects.
func utf16LE(s string) []byte {
	runes := utf16.Encode([]rune(s))
	buf := make([]byte, 0, len(runes)*2)
	for _, r := range runes {
		buf = append(buf, byte(r), byte(r>>8))
	}
	return buf
}

// parseKeyValues splits `key=value` lines emitted by the platform scripts.
// Values are kept as strings; use kvUint for numeric access.
func parseKeyValues(out string) map[string]string {
	kv := make(map[string]string, 16)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), "\r"))
		if line == "" {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		kv[k] = v
	}
	return kv
}

// kvUint reads a numeric value, returning 0 when it is missing or malformed.
func kvUint(kv map[string]string, key string) uint64 {
	n, err := strconv.ParseUint(kv[key], 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// parseSwapField extracts "total = 2048.00M" style values as bytes.
func parseSwapField(out, field string) uint64 {
	idx := strings.Index(out, field)
	if idx < 0 {
		return 0
	}
	rest := out[idx+len(field):]
	if _, after, ok := strings.Cut(rest, "="); ok {
		rest = after
	}
	fields := strings.Fields(strings.TrimSpace(rest))
	if len(fields) == 0 {
		return 0
	}
	return parseSizeToBytes(fields[0])
}

func parseSizeToBytes(tok string) uint64 {
	if tok == "" {
		return 0
	}
	mult := uint64(1)
	last := tok[len(tok)-1]
	switch last {
	case 'K', 'k':
		mult, tok = 1024, tok[:len(tok)-1]
	case 'M', 'm':
		mult, tok = 1024*1024, tok[:len(tok)-1]
	case 'G', 'g':
		mult, tok = 1024*1024*1024, tok[:len(tok)-1]
	case 'T', 't':
		mult, tok = 1024*1024*1024*1024, tok[:len(tok)-1]
	case 'B', 'b':
		tok = tok[:len(tok)-1]
	}
	f, err := strconv.ParseFloat(tok, 64)
	if err != nil || f < 0 {
		return 0
	}
	return uint64(f * float64(mult))
}

// parseVMStatFree returns free memory in bytes from `vm_stat` output.
func parseVMStatFree(out string) uint64 {
	pageSize := uint64(4096)
	if idx := strings.Index(out, "page size of"); idx >= 0 {
		fields := strings.Fields(out[idx:])
		for i, f := range fields {
			if f == "of" && i+1 < len(fields) {
				if n, err := strconv.ParseUint(fields[i+1], 10, 64); err == nil {
					pageSize = n
				}
				break
			}
		}
	}
	var pages uint64
	for _, line := range strings.Split(out, "\n") {
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Pages free", "Pages inactive", "Pages speculative", "Pages purgeable":
			v := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(val), "."))
			if n, err := strconv.ParseUint(v, 10, 64); err == nil {
				pages += n
			}
		}
	}
	return pages * pageSize
}

// parseDF reads `df -k /` output: filesystem, 1024-blocks, used, available.
func parseDF(out string) (used, total uint64, ok bool) {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 2 {
		return 0, 0, false
	}
	fields := strings.Fields(lines[len(lines)-1])
	if len(fields) < 3 {
		return 0, 0, false
	}
	totalKB, err1 := strconv.ParseUint(fields[1], 10, 64)
	usedKB, err2 := strconv.ParseUint(fields[2], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return usedKB * 1024, totalKB * 1024, true
}

// parseLoadAvg reads "{ 1.23 1.45 1.67 }".
func parseLoadAvg(out string) [3]float64 {
	var l [3]float64
	fields := strings.FieldsFunc(out, func(r rune) bool {
		return r == '{' || r == '}' || r == ' ' || r == '\t' || r == '\n' || r == ','
	})
	i := 0
	for _, f := range fields {
		v, err := strconv.ParseFloat(f, 64)
		if err != nil {
			continue
		}
		if i < 3 {
			l[i] = v
			i++
		}
	}
	return l
}

// parseUptimeLoad reads the "load averages: 1.23 1.45 1.67" tail.
func parseUptimeLoad(out string) [3]float64 {
	idx := strings.Index(strings.ToLower(out), "load average")
	if idx < 0 {
		return [3]float64{}
	}
	rest := out[idx:]
	if _, after, ok := strings.Cut(rest, ":"); ok {
		rest = after
	}
	return parseLoadAvg(rest)
}

// parseBootTime reads "{ sec = 1700000000, usec = 0 } ...".
func parseBootTime(out string) (time.Time, bool) {
	idx := strings.Index(out, "sec")
	if idx < 0 {
		return time.Time{}, false
	}
	rest := out[idx:]
	if _, after, ok := strings.Cut(rest, "="); ok {
		rest = after
	}
	fields := strings.FieldsFunc(rest, func(r rune) bool {
		return r == ' ' || r == ',' || r == '}' || r == '\n'
	})
	if len(fields) == 0 {
		return time.Time{}, false
	}
	sec, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil || sec <= 0 {
		return time.Time{}, false
	}
	return time.Unix(sec, 0), true
}
