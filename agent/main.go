// Command vps-dog is the VPS-DOG monitoring agent.
//
// It collects host metrics, runs the latency probes the server asks for, and
// reports everything to a VPS-DOG worker over HTTPS. The wire protocol is
// defined by docs/CONTRACT.md §4.1 and §6.
//
// Zero external dependencies: standard library only.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/heshang2011/vps-dog/agent/internal/client"
	"github.com/heshang2011/vps-dog/agent/internal/collector"
	"github.com/heshang2011/vps-dog/agent/internal/config"
	"github.com/heshang2011/vps-dog/agent/internal/install"
	"github.com/heshang2011/vps-dog/agent/internal/probe"
)

const logPrefix = "[vps-dog]"

func main() {
	os.Exit(run(os.Args[1:]))
}

type flags struct {
	configPath string
	server     string
	token      string
	name       string
	region     string
	interval   int
	once       bool
	showVer    bool
	doInstall  bool
	doUninst   bool
	purge      bool
	tlsSkip    bool

	// set records which flags the user actually provided, so that CLI values
	// can be layered on top of env > file > default without clobbering them
	// with zero values.
	set map[string]bool
}

func run(argv []string) int {
	fs := flag.NewFlagSet("vps-dog", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	f := &flags{set: map[string]bool{}}
	fs.StringVar(&f.configPath, "c", config.DefaultConfigPath, "path to the agent config file")
	fs.StringVar(&f.server, "server", "", "worker base URL, e.g. https://vps-dog.example.workers.dev")
	fs.StringVar(&f.token, "token", "", "agent token issued by the admin API")
	fs.StringVar(&f.name, "name", "", "node display name (sent on first contact)")
	fs.StringVar(&f.region, "region", "", "region label, e.g. HK (sent in host.region)")
	fs.IntVar(&f.interval, "interval", 0, "seconds between reports (10..3600)")
	fs.BoolVar(&f.once, "once", false, "collect once, print the JSON payload to stdout, and exit")
	fs.BoolVar(&f.showVer, "version", false, "print the version and exit")
	fs.BoolVar(&f.doInstall, "install", false, "install the systemd service and config, then enable and start it")
	fs.BoolVar(&f.doUninst, "uninstall", false, "stop, disable and remove the systemd service")
	fs.BoolVar(&f.purge, "purge", false, "with -uninstall: also delete the config directory and the binary")
	fs.BoolVar(&f.tlsSkip, "tls-skip-verify", false, "accept invalid TLS certificates (self-signed workers)")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "VPS-DOG monitoring agent %s\n\n", Version)
		fmt.Fprintf(os.Stderr, "Usage: vps-dog [flags]\n\nFlags:\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nEnvironment (overridden by flags):\n")
		fmt.Fprintf(os.Stderr, "  VPSDOG_SERVER, VPSDOG_TOKEN, VPSDOG_NAME, VPSDOG_REGION,\n")
		fmt.Fprintf(os.Stderr, "  VPSDOG_TLS_SKIP_VERIFY, VPSDOG_CONFIG\n")
	}

	if err := fs.Parse(argv); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	fs.Visit(func(fl *flag.Flag) { f.set[fl.Name] = true })

	if f.showVer {
		fmt.Printf("vps-dog agent %s (%s/%s)\n", Version, runtime.GOOS, runtime.GOARCH)
		return 0
	}

	// ── configuration: file → env → flags ────────────────────────────────
	cfgPath := f.configPath
	if !f.set["c"] {
		if v := strings.TrimSpace(os.Getenv(config.EnvConfig)); v != "" {
			cfgPath = v
		}
	}
	cfg, err := config.LoadFile(cfgPath)
	if err != nil {
		logf("error: %v", err)
		return 1
	}
	if err := cfg.ApplyEnv(); err != nil {
		logf("error: %v", err)
		return 1
	}
	if f.set["server"] {
		cfg.Server = f.server
	}
	if f.set["token"] {
		cfg.Token = f.token
	}
	if f.set["name"] {
		cfg.Name = f.name
	}
	if f.set["region"] {
		cfg.Region = f.region
	}
	if f.set["interval"] {
		cfg.Interval = f.interval
	}
	if f.set["tls-skip-verify"] {
		cfg.TLSSkipVerify = f.tlsSkip
	}
	cfg.Normalize()
	// The worker needs a name on first contact; fall back to the hostname so
	// a bare `vps-dog -server ... -token ...` still registers usefully.
	if cfg.Name == "" {
		if hn, err := os.Hostname(); err == nil {
			cfg.Name = strings.TrimSpace(hn)
		}
	}

	// -once must work on any platform, even without a token, so it is handled
	// before validation: it is the primary debugging and verification path.
	if f.once {
		return runOnce(cfg)
	}

	if f.doInstall {
		if err := cfg.Validate(); err != nil {
			logf("error: %v", err)
			return 1
		}
		opts := install.Options{
			Server:        cfg.Server,
			Token:         cfg.Token,
			Name:          cfg.Name,
			Region:        cfg.Region,
			Interval:      cfg.Interval,
			TLSSkipVerify: cfg.TLSSkipVerify,
			ConfigFile:    cfgPath,
		}
		if err := install.Install(opts); err != nil {
			logf("install failed: %v", err)
			return 1
		}
		logf("installed: %s and %s", install.ServicePath, cfgPath)
		logf("service enabled and started; check it with: systemctl status %s", install.ServiceName)
		return 0
	}

	if f.doUninst {
		if err := install.Uninstall(f.purge); err != nil {
			logf("uninstall failed: %v", err)
			return 1
		}
		if f.purge {
			logf("uninstalled: service, config and binary removed")
		} else {
			logf("uninstalled: service stopped and unit removed (config kept at %s)", install.ConfigPath)
		}
		return 0
	}

	if err := cfg.Validate(); err != nil {
		logf("error: %v", err)
		return 1
	}
	if cfg.Path != "" {
		logf("config loaded from %s", cfg.Path)
	}
	return runLoop(cfg)
}

// runOnce collects a sample and prints the exact JSON payload that would be
// POSTed. It never touches the network.
func runOnce(cfg config.Config) int {
	col := collector.New()
	sample, err := col.Collect()
	if err != nil {
		// Still print whatever we managed to gather.
		logf("warning: partial sample: %v", err)
	}
	host := col.Host()
	if cfg.Region != "" {
		host.Region = cfg.Region
	}
	payload := client.ReportRequest{
		Name:    cfg.Name,
		Version: Version,
		Host:    &host,
		Metrics: sample,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(payload); err != nil {
		logf("error: encode payload: %v", err)
		return 1
	}
	return 0
}

// runLoop is the main collect → probe → report → sleep cycle.
func runLoop(cfg config.Config) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	col := collector.New()
	cl := client.New(client.Config{
		Server:        cfg.Server,
		Token:         cfg.Token,
		Name:          cfg.Name,
		Version:       Version,
		TLSSkipVerify: cfg.TLSSkipVerify,
	})
	defer cl.Close()

	logf("starting vps-dog agent %s (%s/%s)", Version, runtime.GOOS, runtime.GOARCH)
	logf("reporting to %s every %ds", cl.Endpoint(), cfg.Interval)
	if cfg.Name != "" {
		logf("node name: %s", cfg.Name)
	}

	interval := config.ClampInterval(cfg.Interval)
	tasks := []probe.Task(nil) // first run: no probes, the server has not told us yet
	hostSent := false
	attempt := 1

	for {
		if ctx.Err() != nil {
			break
		}

		sample, err := col.Collect()
		if err != nil {
			logf("collect warning: %v", err)
		}

		results := probe.RunAll(tasks)

		req := client.ReportRequest{
			Version: Version,
			Metrics: sample,
			Pings:   results,
		}
		// The name (and host block) are only needed on first contact, but
		// re-sending them is harmless and makes a token rotation to a fresh
		// node id self-healing.
		if !hostSent {
			req.Name = cfg.Name
			host := col.Host()
			if cfg.Region != "" {
				host.Region = cfg.Region
			}
			req.Host = &host
		}

		resp, err := cl.Report(ctx, req)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			if !client.Retryable(err) {
				logf("report rejected: %v", err)
				// Permanent errors: keep the normal cadence instead of
				// hammering the server with a bad token.
				if !sleepCtx(ctx, time.Duration(interval)*time.Second) {
					break
				}
				continue
			}
			delay, next := client.Backoff(attempt)
			attempt = next
			logf("report failed (attempt %d): %v — retrying in %s", attempt-1, err, delay)
			if !sleepCtx(ctx, delay) {
				break
			}
			continue
		}

		// Success: reset the backoff and adopt the server's interval.
		attempt = 1
		hostSent = true
		if resp.NodeID != "" {
			logf("report ok (node %s)", resp.NodeID)
		} else {
			logf("report ok")
		}
		if resp.Interval > 0 {
			next := config.ClampInterval(resp.Interval)
			if next != interval {
				logf("server set report interval to %ds", next)
			}
			interval = next
		}
		tasks = resp.Pings // nil-safe: an absent array simply clears the tasks
		if len(tasks) > 0 {
			logf("%d probe task(s) from server", len(tasks))
		}

		if !sleepCtx(ctx, time.Duration(interval)*time.Second) {
			break
		}
	}

	logf("shutting down")
	return 0
}

// sleepCtx sleeps for d, returning false if the context was cancelled.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func logf(format string, args ...any) {
	ts := time.Now().Format("2006-01-02 15:04:05")
	fmt.Fprintf(os.Stdout, "%s %s %s\n", ts, logPrefix, fmt.Sprintf(format, args...))
}
