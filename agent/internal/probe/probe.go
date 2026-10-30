// Package probe implements the latency probes described in
// docs/CONTRACT.md §6: icmp, tcp and http.
//
// Every probe is bounded by a timeout and returns a latency in milliseconds
// plus an ok flag. A failed probe must return ok=false and value=-1 so the
// worker can record packet loss.
package probe

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Probe types understood by the worker (ping_tasks.type).
const (
	TypeICMP = "icmp"
	TypeTCP  = "tcp"
	TypeHTTP = "http"
)

// Timeouts, per contract §6.
const (
	TCPTimeout  = 3 * time.Second
	HTTPTimeout = 5 * time.Second
	ICMPTimeout = 2 * time.Second
)

// FailedValue is the latency reported for an unsuccessful probe (§6).
const FailedValue = -1

// Task is a probe the server asked this node to run. It mirrors the `pings`
// entries of the report response (§4.1).
type Task struct {
	ID       string `json:"id,omitempty"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Target   string `json:"target"`
	Interval int    `json:"interval,omitempty"`
}

// Result is one completed probe, ready to be embedded in the report body.
type Result struct {
	Name   string  `json:"name"`
	Type   string  `json:"type"`
	Target string  `json:"target"`
	Value  float64 `json:"value"` // milliseconds; -1 on failure
	OK     int     `json:"ok"`    // 1 or 0
}

// Run executes a single task with a bounded timeout and never panics.
func Run(t Task) Result {
	res := Result{Name: t.Name, Type: t.Type, Target: t.Target, Value: FailedValue, OK: 0}

	switch strings.ToLower(strings.TrimSpace(t.Type)) {
	case TypeICMP:
		if ms, ok := ICMP(t.Target); ok {
			res.Value, res.OK = ms, 1
		}
	case TypeTCP:
		if ms, ok := TCP(t.Target, TCPTimeout); ok {
			res.Value, res.OK = ms, 1
		}
	case TypeHTTP:
		if ms, ok := HTTP(t.Target, HTTPTimeout, false); ok {
			res.Value, res.OK = ms, 1
		}
	default:
		// Unknown probe types are reported as failed rather than dropped, so
		// the dashboard surfaces the misconfiguration.
	}
	return res
}

// RunAll executes every task, optionally in parallel, preserving order.
func RunAll(tasks []Task) []Result {
	if len(tasks) == 0 {
		return nil
	}
	out := make([]Result, len(tasks))
	done := make(chan int, len(tasks))
	for i, t := range tasks {
		go func(i int, t Task) {
			out[i] = Run(t)
			done <- i
		}(i, t)
	}
	for range tasks {
		<-done
	}
	return out
}

// ── tcp ──────────────────────────────────────────────────────────────────

// TCP measures the time to establish a TCP connection to target (host:port).
func TCP(target string, timeout time.Duration) (float64, bool) {
	target = strings.TrimSpace(target)
	if target == "" {
		return FailedValue, false
	}
	if timeout <= 0 {
		timeout = TCPTimeout
	}
	start := time.Now()
	conn, err := net.DialTimeout("tcp", target, timeout)
	if err != nil {
		return FailedValue, false
	}
	elapsed := time.Since(start)
	_ = conn.Close()
	return millis(elapsed), true
}

// ── http ─────────────────────────────────────────────────────────────────

// HTTP issues a GET and measures time to first byte. ok is true when the
// response status is below 400 (contract §6).
func HTTP(target string, timeout time.Duration, skipVerify bool) (float64, bool) {
	target = strings.TrimSpace(target)
	if target == "" {
		return FailedValue, false
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	if timeout <= 0 {
		timeout = HTTPTimeout
	}

	tr := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   timeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   timeout,
		ResponseHeaderTimeout: timeout,
		DisableKeepAlives:     true,
		MaxIdleConns:          1,
	}
	if skipVerify {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // explicit opt-in via tls_skip_verify
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
	defer client.CloseIdleConnections()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return FailedValue, false
	}
	req.Header.Set("User-Agent", "vps-dog-agent")

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return FailedValue, false
	}
	elapsed := time.Since(start)
	// Drain a little so the connection can be reused/closed cleanly, then close.
	_, _ = readSome(resp.Body)
	_ = resp.Body.Close()

	if resp.StatusCode >= 400 {
		// The request completed but the probe failed: report -1 like any
		// other failure so the dashboard does not average in a bogus RTT.
		return FailedValue, false
	}
	return millis(elapsed), true
}

// ── icmp ─────────────────────────────────────────────────────────────────

// ICMP sends a single echo request. When the process can open a raw socket
// (root on Unix, elevated on Windows) the echo is crafted in-process;
// otherwise this falls back to the system `ping` binary, as the contract
// specifies.
func ICMP(target string) (float64, bool) {
	target = strings.TrimSpace(target)
	if target == "" {
		return FailedValue, false
	}
	// A target may be written as "host:port" for consistency with tcp tasks.
	if h, _, err := net.SplitHostPort(target); err == nil && h != "" {
		target = h
	}
	if target == "" {
		return FailedValue, false
	}

	if ms, ok := rawICMP(target, ICMPTimeout); ok {
		return ms, true
	}
	return pingBinary(target)
}

// rawICMP crafts an ICMPv4 echo request on a raw socket. It returns ok=false
// whenever the socket cannot be opened (no privileges) or no reply arrives,
// letting the caller fall back to the ping binary.
func rawICMP(host string, timeout time.Duration) (ms float64, ok bool) {
	defer func() {
		if recover() != nil {
			ms, ok = FailedValue, false
		}
	}()

	ip, err := net.ResolveIPAddr("ip4", host)
	if err != nil || ip == nil {
		return FailedValue, false
	}
	conn, err := net.DialIP("ip4:icmp", nil, ip)
	if err != nil {
		return FailedValue, false
	}
	defer conn.Close()

	id := os.Getpid() & 0xffff
	const seq = 1
	const payload = 32

	msg := make([]byte, 8+payload)
	msg[0] = 8 // echo request
	msg[1] = 0 // code
	binary.BigEndian.PutUint16(msg[4:6], uint16(id))
	binary.BigEndian.PutUint16(msg[6:8], seq)
	stamp := time.Now().UnixNano()
	binary.BigEndian.PutUint64(msg[8:16], uint64(stamp))
	for i := 16; i < len(msg); i++ {
		msg[i] = byte(i)
	}
	binary.BigEndian.PutUint16(msg[2:4], icmpChecksum(msg))

	start := time.Now()
	if _, err := conn.Write(msg); err != nil {
		return FailedValue, false
	}
	if timeout <= 0 {
		timeout = ICMPTimeout
	}
	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return FailedValue, false
	}

	buf := make([]byte, 1500)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			return FailedValue, false
		}
		elapsed := time.Since(start)

		// Raw IPv4 sockets deliver the IP header too; skip it when present.
		off := 0
		if n >= 20 && buf[0]>>4 == 4 {
			off = int(buf[0]&0x0f) * 4
		}
		if n < off+8 {
			continue
		}
		icmp := buf[off:n]
		if icmp[0] != 0 { // not an echo reply
			continue
		}
		if binary.BigEndian.Uint16(icmp[4:6]) != uint16(id) {
			continue
		}
		return millis(elapsed), true
	}
}

// icmpChecksum computes the standard one's-complement ICMP checksum.
func icmpChecksum(b []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(b); i += 2 {
		sum += uint32(b[i])<<8 | uint32(b[i+1])
	}
	if len(b)%2 == 1 {
		sum += uint32(b[len(b)-1]) << 8
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

// pingBinary is the unprivileged fallback: it shells out to the platform's
// ping command with a single echo request.
func pingBinary(target string) (float64, bool) {
	args := pingArgs(target)
	if len(args) == 0 {
		return FailedValue, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), ICMPTimeout+3*time.Second)
	defer cancel()

	start := time.Now()
	out, err := exec.CommandContext(ctx, args[0], args[1:]...).Output()
	elapsed := time.Since(start)
	if err != nil && len(out) == 0 {
		return FailedValue, false
	}
	if ms, ok := parsePingTime(string(out)); ok {
		return ms, true
	}
	// No parseable RTT but a zero exit status: report the wall-clock time.
	if err == nil {
		return millis(elapsed), true
	}
	return FailedValue, false
}

func pingArgs(target string) []string {
	switch runtime.GOOS {
	case "windows":
		return []string{"ping", "-n", "1", "-w", "2000", target}
	case "darwin", "freebsd", "openbsd", "netbsd", "dragonfly":
		return []string{"ping", "-c", "1", "-W", "2000", target}
	default:
		return []string{"ping", "-c", "1", "-W", "2", target}
	}
}

// parsePingTime extracts the round-trip time from ping output. It handles the
// Linux/macOS "time=12.3 ms" form and the Windows "time=12ms" / "time<1ms"
// forms.
func parsePingTime(out string) (float64, bool) {
	lower := strings.ToLower(out)
	for _, marker := range []string{"time=", "time<", "time>"} {
		idx := strings.Index(lower, marker)
		if idx < 0 {
			continue
		}
		rest := lower[idx+len(marker):]
		end := 0
		for end < len(rest) {
			c := rest[end]
			if (c >= '0' && c <= '9') || c == '.' {
				end++
				continue
			}
			break
		}
		if end == 0 {
			continue
		}
		if v, err := strconv.ParseFloat(rest[:end], 64); err == nil {
			return v, true
		}
	}
	return 0, false
}

// ── helpers ──────────────────────────────────────────────────────────────

func millis(d time.Duration) float64 {
	ms := float64(d) / float64(time.Millisecond)
	if ms < 0 {
		return 0
	}
	// Two decimals is plenty for a latency figure.
	return float64(int64(ms*100+0.5)) / 100
}

func readSome(rc interface{ Read([]byte) (int, error) }) (int, error) {
	buf := make([]byte, 512)
	return rc.Read(buf)
}

// String renders a result for logging.
func (r Result) String() string {
	status := "ok"
	if r.OK != 1 {
		status = "fail"
	}
	return fmt.Sprintf("%s(%s) %s %.2fms", r.Name, r.Type, status, r.Value)
}
