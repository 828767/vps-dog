//go:build linux

package collector

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// platformCPUPercent is false on Linux: the CPU percentage is derived from
// the /proc/stat delta by the shared logic in collector.go.
func platformCPUPercent() (float64, bool) { return 0, false }

// ── /proc/stat → CPU times ───────────────────────────────────────────────

func readCPUTimes() (cpuTimes, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuTimes{}, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:] // drop the "cpu" label
		var v [10]uint64
		for i := 0; i < len(fields) && i < len(v); i++ {
			v[i], _ = strconv.ParseUint(fields[i], 10, 64)
		}
		// user nice system idle iowait irq softirq steal guest guest_nice
		return cpuTimes{
			User:    v[0],
			Nice:    v[1],
			System:  v[2],
			Idle:    v[3],
			Iowait:  v[4],
			Irq:     v[5],
			Softirq: v[6],
			Steal:   v[7],
		}, nil
	}
	if err := sc.Err(); err != nil {
		return cpuTimes{}, err
	}
	return cpuTimes{}, os.ErrNotExist
}

// ── /proc/meminfo → memory and swap, in bytes ────────────────────────────

func readMemInfo() (memInfo, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return memInfo{}, err
	}
	defer f.Close()

	var mi memInfo
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		key, raw, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		kb, err := parseMemValueKB(raw)
		if err != nil {
			continue
		}
		switch key {
		case "MemTotal":
			mi.MemTotal = kb * 1024
		case "MemAvailable":
			mi.MemAvailable = kb * 1024
		case "MemFree":
			// Only used as a fallback when MemAvailable is unavailable
			// (kernels older than 3.14).
			if mi.MemAvailable == 0 {
				mi.MemAvailable = kb * 1024
			}
		case "SwapTotal":
			mi.SwapTotal = kb * 1024
		case "SwapFree":
			mi.SwapFree = kb * 1024
		}
	}
	if err := sc.Err(); err != nil {
		return memInfo{}, err
	}
	return mi, nil
}

// parseMemValueKB reads "  15987654 kB" and returns the number in kB.
func parseMemValueKB(raw string) (uint64, error) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0, os.ErrInvalid
	}
	n, err := strconv.ParseUint(fields[0], 10, 64)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// ── syscall.Statfs on "/" → root filesystem usage ────────────────────────

func readDiskRoot() (used, total uint64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err != nil {
		return 0, 0, err
	}
	bsize := uint64(st.Bsize)
	total = st.Blocks * bsize
	free := st.Bavail * bsize
	if free > total {
		free = total
	}
	used = total - free
	return used, total, nil
}

// ── /proc/net/dev → cumulative non-loopback byte counters ────────────────

func readNetDev() (rx, tx uint64, err error) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		name, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue // the two header lines
		}
		name = strings.TrimSpace(name)
		if name == "lo" || name == "" {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 9 {
			continue
		}
		// rx: bytes packets errs drop fifo frame compressed multicast
		// tx: bytes packets errs drop fifo colls carrier compressed
		r, e1 := strconv.ParseUint(fields[0], 10, 64)
		t, e2 := strconv.ParseUint(fields[8], 10, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		rx += r
		tx += t
	}
	if err := sc.Err(); err != nil {
		return 0, 0, err
	}
	return rx, tx, nil
}

// ── /proc/net/tcp*, /proc/net/udp → socket counts ────────────────────────

func readSocketCounts() (tcp, udp int, err error) {
	var firstErr error
	for _, p := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		n, e := countProcNetRows(p)
		if e != nil {
			if firstErr == nil {
				firstErr = e
			}
			continue
		}
		tcp += n
	}
	for _, p := range []string{"/proc/net/udp", "/proc/net/udp6"} {
		n, e := countProcNetRows(p)
		if e != nil {
			if firstErr == nil {
				firstErr = e
			}
			continue
		}
		udp += n
	}
	if tcp == 0 && udp == 0 && firstErr != nil {
		return 0, 0, firstErr
	}
	return tcp, udp, nil
}

// countProcNetRows counts established-ish socket rows: every line after the
// header whose local port is not 0 (i.e. a real socket, not a TIME_WAIT husk
// with no bound port is still counted — we simply count all rows).
func countProcNetRows(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	n := 0
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	first := true
	for sc.Scan() {
		if first {
			first = false
			continue // header
		}
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		n++
	}
	if err := sc.Err(); err != nil {
		return 0, err
	}
	return n, nil
}

// ── /proc → process count ────────────────────────────────────────────────

func readProcessCount() (int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if name == "" || name[0] < '0' || name[0] > '9' {
			continue
		}
		if _, err := strconv.Atoi(name); err != nil {
			continue
		}
		n++
	}
	return n, nil
}

// ── /proc/uptime ─────────────────────────────────────────────────────────

func readUptime() (uint64, error) {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0, os.ErrInvalid
	}
	secs, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, err
	}
	if secs < 0 {
		return 0, nil
	}
	return uint64(secs), nil
}

// ── /proc/loadavg ────────────────────────────────────────────────────────

func readLoad() (l1, l5, l15 float64, err error) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, err
	}
	fields := strings.Fields(string(b))
	if len(fields) < 3 {
		return 0, 0, 0, os.ErrInvalid
	}
	l1, err = strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, 0, 0, err
	}
	l5, err = strconv.ParseFloat(fields[1], 64)
	if err != nil {
		return 0, 0, 0, err
	}
	l15, err = strconv.ParseFloat(fields[2], 64)
	if err != nil {
		return 0, 0, 0, err
	}
	return l1, l5, l15, nil
}

// ── /proc/cpuinfo → CPU model and logical core count ─────────────────────

func readCPUInfo() (string, error) {
	b, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// cpuModel returns the CPU model name, "" when unavailable.
func cpuModel() string {
	content, err := readCPUInfo()
	if err != nil {
		return ""
	}
	model, _ := parseCPUInfo(content)
	return model
}

// cpuCores returns the logical core count, 0 when /proc/cpuinfo is unreadable
// (the caller falls back to runtime.NumCPU).
func cpuCores() int {
	content, err := readCPUInfo()
	if err != nil {
		return 0
	}
	_, cores := parseCPUInfo(content)
	return cores
}

// osName reports a human-readable distribution name, e.g. "Ubuntu 24.04".
func osName() string {
	pretty := parseOSRelease("/etc/os-release")
	if pretty == "" {
		pretty = parseOSRelease("/usr/lib/os-release")
	}
	if pretty != "" {
		return pretty
	}
	if b, err := os.ReadFile("/etc/issue"); err == nil {
		line := strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0])
		line = strings.TrimSuffix(line, `\n`)
		line = strings.TrimSuffix(line, `\l`)
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return "Linux"
}

func parseOSRelease(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	var name, version, id, versionID string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		key, val, ok := strings.Cut(sc.Text(), "=")
		if !ok {
			continue
		}
		val = unquote(strings.TrimSpace(val))
		switch strings.TrimSpace(key) {
		case "PRETTY_NAME":
			if val != "" {
				return val
			}
		case "NAME":
			name = val
		case "VERSION":
			version = val
		case "ID":
			id = val
		case "VERSION_ID":
			versionID = val
		}
	}
	if name != "" && version != "" {
		return name + " " + version
	}
	if id != "" && versionID != "" {
		return id + " " + versionID
	}
	return name
}

func unquote(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}
