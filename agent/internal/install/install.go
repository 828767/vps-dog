// Package install manages the systemd service and on-disk configuration for
// the VPS-DOG agent (contract §6, `-install` / `-uninstall`).
//
// Everything here is Linux-only by nature; on other platforms the entry
// points refuse gracefully instead of failing hard.
package install

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// Well-known paths.
const (
	ServicePath  = "/etc/systemd/system/vps-dog.service"
	ConfigDir    = "/etc/vps-dog"
	ConfigPath   = "/etc/vps-dog/agent.yaml"
	BinaryPath   = "/usr/local/bin/vps-dog"
	ServiceName  = "vps-dog"
	SystemdDir   = "/etc/systemd/system"
	BinaryEnvKey = "VPSDOG_BIN"
)

// Options describes what to write during installation.
type Options struct {
	Server        string
	Token         string
	Name          string
	Region        string
	Interval      int
	TLSSkipVerify bool

	// Binary is the executable path recorded in the unit file. It defaults to
	// the running executable, or to BinaryPath when that cannot be determined.
	Binary string
	// ConfigPath overrides the config file location (defaults to ConfigPath).
	ConfigFile string
	// ServicePath overrides the unit file location (defaults to ServicePath).
	ServiceFile string
}

// ErrNotRoot is returned when installation is attempted without root.
var ErrNotRoot = errors.New("must be run as root (try: sudo vps-dog -install ...)")

// ErrNoSystemd is returned when the host does not run systemd.
var ErrNoSystemd = errors.New("systemd was not found on this host; install the agent manually")

// IsRoot reports whether the current process runs as uid 0.
func IsRoot() bool {
	if runtime.GOOS == "windows" {
		return false
	}
	if os.Geteuid() == 0 {
		return true
	}
	// Fall back to the user database for exotic setups.
	if u, err := user.Current(); err == nil && u.Uid == "0" {
		return true
	}
	return false
}

// HasSystemd reports whether systemctl is available and systemd is PID 1.
func HasSystemd() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	// /run/systemd/system exists only when systemd is the running init.
	if fi, err := os.Stat("/run/systemd/system"); err == nil && fi.IsDir() {
		return true
	}
	return false
}

// Preflight checks that installation can proceed, returning a descriptive
// error otherwise.
func Preflight() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("automatic install is only supported on Linux (this is %s)", runtime.GOOS)
	}
	if !IsRoot() {
		return ErrNotRoot
	}
	if !HasSystemd() {
		return ErrNoSystemd
	}
	return nil
}

// Install writes the config file and the systemd unit, then enables and
// starts the service.
func Install(opts Options) error {
	if err := Preflight(); err != nil {
		return err
	}
	if strings.TrimSpace(opts.Server) == "" {
		return errors.New("server is required for -install (use -server or VPSDOG_SERVER)")
	}
	if strings.TrimSpace(opts.Token) == "" {
		return errors.New("token is required for -install (use -token or VPSDOG_TOKEN)")
	}

	cfgPath := opts.ConfigFile
	if cfgPath == "" {
		cfgPath = ConfigPath
	}
	svcPath := opts.ServiceFile
	if svcPath == "" {
		svcPath = ServicePath
	}

	if err := os.MkdirAll(filepath.Dir(cfgPath), 0o750); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(cfgPath), err)
	}
	if err := writeFile(cfgPath, 0o600, RenderConfig(opts)); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(svcPath), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(svcPath), err)
	}
	if err := writeFile(svcPath, 0o644, RenderUnit(binaryPath(opts), cfgPath)); err != nil {
		return err
	}

	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	if err := systemctl("enable", "--now", ServiceName); err != nil {
		return err
	}
	return nil
}

// Uninstall stops and disables the service and removes the unit file. The
// configuration and the binary are removed only when purge is true.
func Uninstall(purge bool) error {
	if err := Preflight(); err != nil {
		return err
	}
	var errs []string

	// Best effort: the unit may already be gone.
	if err := systemctl("disable", "--now", ServiceName); err != nil {
		errs = append(errs, err.Error())
	}
	if err := os.Remove(ServicePath); err != nil && !os.IsNotExist(err) {
		errs = append(errs, fmt.Sprintf("remove %s: %v", ServicePath, err))
	}
	if err := systemctl("daemon-reload"); err != nil {
		errs = append(errs, err.Error())
	}
	if err := systemctl("reset-failed", ServiceName); err != nil {
		// Not an error worth reporting: the unit may never have failed.
		_ = err
	}
	if purge {
		if err := os.RemoveAll(ConfigDir); err != nil {
			errs = append(errs, fmt.Sprintf("remove %s: %v", ConfigDir, err))
		}
		if exe, err := os.Executable(); err == nil {
			if resolved, err := filepath.EvalSymlinks(exe); err == nil {
				exe = resolved
			}
			if err := os.Remove(exe); err != nil && !os.IsNotExist(err) {
				errs = append(errs, fmt.Sprintf("remove %s: %v", exe, err))
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("uninstall completed with warnings: %s", strings.Join(errs, "; "))
	}
	return nil
}

func binaryPath(opts Options) string {
	if strings.TrimSpace(opts.Binary) != "" {
		return opts.Binary
	}
	if v := strings.TrimSpace(os.Getenv(BinaryEnvKey)); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil && exe != "" {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		return exe
	}
	return BinaryPath
}

// RenderConfig produces the agent.yaml written by -install.
func RenderConfig(opts Options) string {
	var b strings.Builder
	b.WriteString("# VPS-DOG agent configuration\n")
	b.WriteString("# Generated by `vps-dog -install`. CLI flags and VPSDOG_* environment\n")
	b.WriteString("# variables override these values.\n\n")
	fmt.Fprintf(&b, "server: %s\n", strconv.Quote(strings.TrimRight(opts.Server, "/")))
	fmt.Fprintf(&b, "token: %s\n", strconv.Quote(opts.Token))
	if opts.Name != "" {
		fmt.Fprintf(&b, "name: %s\n", strconv.Quote(opts.Name))
	}
	if opts.Region != "" {
		fmt.Fprintf(&b, "region: %s\n", strconv.Quote(opts.Region))
	}
	interval := opts.Interval
	if interval <= 0 {
		interval = 30
	}
	fmt.Fprintf(&b, "interval: %d\n", interval)
	fmt.Fprintf(&b, "tls_skip_verify: %t\n", opts.TLSSkipVerify)
	return b.String()
}

// RenderUnit produces the systemd unit file.
func RenderUnit(binary, config string) string {
	if binary == "" {
		binary = BinaryPath
	}
	if config == "" {
		config = ConfigPath
	}
	return fmt.Sprintf(`[Unit]
Description=VPS-DOG monitoring agent
Documentation=https://github.com/heshang2011/vps-dog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s -c %s
Restart=always
RestartSec=5
# Keep retrying forever; the agent handles its own backoff.
StartLimitIntervalSec=0
User=root
Environment=VPSDOG_CONFIG=%s

# Light hardening: the agent only needs /proc, /etc and the network.
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/etc/vps-dog

[Install]
WantedBy=multi-user.target
`, binary, config, config)
}

func writeFile(path string, mode os.FileMode, content string) error {
	// Write atomically so a crash cannot leave a half-written config behind.
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), mode); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Chmod(tmp, mode); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("chmod %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("install %s: %w", path, err)
	}
	return nil
}

func systemctl(args ...string) error {
	cmd := exec.Command("systemctl", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("systemctl %s: %s", strings.Join(args, " "), msg)
	}
	return nil
}
