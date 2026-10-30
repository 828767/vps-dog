// Package collector gathers host metrics for the VPS-DOG agent.
//
// Linux is the primary platform (see linux.go); every other OS degrades
// gracefully to zeros (see other.go) and must never panic.
package collector

import (
	"fmt"
	"math"
	"runtime"
	"strings"
	"sync"
	"time"
)

// cpuTimes is the raw /proc/stat "cpu" line (or a portable equivalent),
// in USER_HZ ticks. Not every platform fills every field.
type cpuTimes struct {
	User, Nice, System, Idle, Iowait, Irq, Softirq, Steal uint64
}

// busy returns the "not idle" part of the sample.
func (c cpuTimes) busy() uint64 {
	return c.User + c.Nice + c.System + c.Irq + c.Softirq + c.Steal
}

// total returns the whole sample.
func (c cpuTimes) total() uint64 {
	return c.busy() + c.Idle + c.Iowait
}

// memInfo is the portable memory/swap snapshot, in bytes.
type memInfo struct {
	MemTotal     uint64
	MemAvailable uint64
	SwapTotal    uint64
	SwapFree     uint64
}

// Collector keeps the state needed to turn cumulative counters into rates.
// It is safe for concurrent use, although the run loop uses a single goroutine.
type Collector struct {
	mu        sync.Mutex
	primed    bool
	collected bool
	prevCPU   cpuTimes
	prevRx    uint64
	prevTx    uint64
	prevAt    time.Time
	host      Host
}

// New returns a Collector with an initial counter read, so the very first
// Collect call can already produce a meaningful CPU percentage.
func New() *Collector {
	c := &Collector{}
	c.prime()
	return c
}

func (c *Collector) prime() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.primeLocked()
}

func (c *Collector) primeLocked() {
	if t, err := readCPUTimes(); err == nil {
		c.prevCPU = t
	}
	if rx, tx, err := readNetDev(); err == nil {
		c.prevRx, c.prevTx = rx, tx
	}
	c.prevAt = time.Now()
	c.primed = true
}

// Collect returns a best-effort metric sample. Partial read failures are
// tolerated and simply yield zeros for the affected fields; an error is
// returned only when even the fallback reads produced nothing usable.
func (c *Collector) Collect() (MetricSample, error) {
	c.mu.Lock()
	if !c.primed {
		c.primeLocked()
	}
	prevCPU := c.prevCPU
	prevRx, prevTx := c.prevRx, c.prevTx
	prevAt := c.prevAt
	firstSample := !c.collected
	c.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(prevAt).Seconds()

	var s MetricSample
	var errs []error
	var curCPU cpuTimes
	var haveCPU bool

	// ── CPU ──────────────────────────────────────────────────────────────
	// Platforms that expose an instantaneous CPU percentage (Windows) report
	// it directly; everything else uses the /proc/stat delta.
	if pct, ok := platformCPUPercent(); ok {
		s.CPU = clampPercent(pct)
	} else if t, err := readCPUTimes(); err != nil {
		errs = append(errs, fmt.Errorf("cpu: %w", err))
	} else {
		curCPU, haveCPU = t, true
		if dt := curCPU.total() - prevCPU.total(); dt > 0 {
			db := curCPU.busy() - prevCPU.busy()
			s.CPU = clampPercent(float64(db) / float64(dt) * 100)
		}
	}

	// ── memory / swap ────────────────────────────────────────────────────
	if mi, err := readMemInfo(); err != nil {
		errs = append(errs, fmt.Errorf("mem: %w", err))
	} else {
		s.MemTotal = mi.MemTotal
		if mi.MemAvailable <= mi.MemTotal {
			s.MemUsed = mi.MemTotal - mi.MemAvailable
		}
		s.SwapTotal = mi.SwapTotal
		if mi.SwapFree <= mi.SwapTotal {
			s.SwapUsed = mi.SwapTotal - mi.SwapFree
		}
	}

	// ── disk (root filesystem) ───────────────────────────────────────────
	if used, total, err := readDiskRoot(); err != nil {
		errs = append(errs, fmt.Errorf("disk: %w", err))
	} else {
		s.DiskUsed, s.DiskTotal = used, total
	}

	// ── network (cumulative, non-loopback) + rates ───────────────────────
	if rx, tx, err := readNetDev(); err != nil {
		errs = append(errs, fmt.Errorf("net: %w", err))
	} else {
		s.NetIn, s.NetOut = rx, tx
		// Contract §6: the rates are 0 on the very first sample.
		if elapsed > 0 && !firstSample {
			if rx >= prevRx {
				s.RxRate = float64(rx-prevRx) / elapsed
			}
			if tx >= prevTx {
				s.TxRate = float64(tx-prevTx) / elapsed
			}
		}
	}

	// ── sockets ──────────────────────────────────────────────────────────
	if tcp, udp, err := readSocketCounts(); err != nil {
		errs = append(errs, fmt.Errorf("sockets: %w", err))
	} else {
		s.TCP, s.UDP = tcp, udp
	}

	// ── processes ────────────────────────────────────────────────────────
	if n, err := readProcessCount(); err != nil {
		errs = append(errs, fmt.Errorf("process: %w", err))
	} else {
		s.Process = n
	}

	// ── uptime ───────────────────────────────────────────────────────────
	if up, err := readUptime(); err != nil {
		errs = append(errs, fmt.Errorf("uptime: %w", err))
	} else {
		s.Uptime = up
	}

	// ── load average ─────────────────────────────────────────────────────
	if l1, l5, l15, err := readLoad(); err != nil {
		errs = append(errs, fmt.Errorf("load: %w", err))
	} else {
		s.Load1, s.Load5, s.Load15 = l1, l5, l15
	}

	// Store this sample as the baseline for the next one.
	c.mu.Lock()
	if haveCPU {
		c.prevCPU = curCPU
	}
	if s.NetIn != 0 || s.NetOut != 0 {
		c.prevRx, c.prevTx = s.NetIn, s.NetOut
	}
	c.prevAt = now
	c.collected = true
	c.mu.Unlock()

	if len(errs) == metricSourceCount {
		return s, fmt.Errorf("all metric sources failed: %v", errs)
	}
	return s, nil
}

// metricSourceCount is the number of independent readers Collect attempts; it
// is only used to decide whether a sample is completely useless.
const metricSourceCount = 8

// Host returns static host information for the report envelope. CPU model and
// core count are resolved once and cached alongside OS/arch.
func (c *Collector) Host() Host {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.host.OS == "" {
		model := cpuModel()
		cores := cpuCores()
		if cores <= 0 {
			cores = runtime.NumCPU()
		}
		c.host = Host{OS: osName(), Arch: archName(), CPUModel: model, CPUCores: cores}
	}
	return c.host
}

// parseCPUInfo extracts the CPU model and logical core count from the text of
// /proc/cpuinfo. It is a pure function (compiled on every platform) so it can
// be unit-tested anywhere; only the file read itself is Linux-specific.
//
// x86 and most ARM SoCs expose `model name`; some ARM boards only have
// `Processor`, `Hardware` or `Model Name`. The core count is the number of
// `processor` entries.
func parseCPUInfo(content string) (model string, cores int) {
	fallbackModel := ""
	for _, line := range strings.Split(content, "\n") {
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key, val = strings.TrimSpace(key), strings.TrimSpace(val)
		switch key {
		case "processor":
			cores++
		case "model name", "Model Name", "Processor", "Hardware":
			if val == "" {
				continue
			}
			switch key {
			case "model name", "Model Name":
				// Prefer the descriptive fields; keep the first one seen.
				if model == "" {
					model = val
				}
			default:
				// Lower-quality fallbacks; keep the first one seen.
				if fallbackModel == "" {
					fallbackModel = val
				}
			}
		}
	}
	if model == "" {
		model = fallbackModel
	}
	return model, cores
}

func clampPercent(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return math.Round(v*100) / 100
}

// ── portable helpers shared by the platform files ─────────────────────────

// archName maps Go's GOARCH onto the names the dashboard prefers.
func archName() string {
	switch runtime.GOARCH {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	case "arm":
		return "armv7"
	case "386":
		return "i686"
	default:
		return runtime.GOARCH
	}
}
