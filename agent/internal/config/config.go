// Package config loads the VPS-DOG agent configuration.
//
// The on-disk format is the small flat YAML subset documented in
// docs/CONTRACT.md §6. It is parsed by a tiny hand-written parser so that the
// agent keeps its "zero external dependencies, builds offline" guarantee.
//
// Precedence (highest first): CLI flag > environment variable > config file >
// built-in default. This package implements the file and environment layers;
// main.go applies the flags on top.
package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Environment variable names, per contract §6.
const (
	EnvServer = "VPSDOG_SERVER"
	EnvToken  = "VPSDOG_TOKEN"
	EnvName   = "VPSDOG_NAME"
	EnvRegion = "VPSDOG_REGION"
	EnvTLS    = "VPSDOG_TLS_SKIP_VERIFY"
	EnvConfig = "VPSDOG_CONFIG"
)

// DefaultConfigPath is where -install writes the configuration and where the
// agent looks for it when -c is not given.
const DefaultConfigPath = "/etc/vps-dog/agent.yaml"

// Config is the fully-resolved agent configuration.
type Config struct {
	Server        string // base URL of the worker, e.g. https://vps-dog.example.workers.dev
	Token         string // 64 hex chars, issued by the admin API
	Name          string // node display name, sent on first contact
	Region        string // optional region hint sent in host.region
	Interval      int    // seconds between reports (server may override)
	TLSSkipVerify bool   // accept self-signed / invalid TLS certificates

	Path string // config file the values came from ("" when none was read)
}

// Defaults returns the built-in defaults.
func Defaults() Config {
	return Config{
		Server:   "http://127.0.0.1:8787",
		Interval: 30,
	}
}

// LoadFile reads and parses path. A missing file is not an error: the agent
// falls back to defaults plus env/flags (the config file is optional).
func LoadFile(path string) (Config, error) {
	cfg := Defaults()
	cfg.Path = path
	if strings.TrimSpace(path) == "" {
		return cfg, nil
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg.Path = ""
			return cfg, nil
		}
		return cfg, fmt.Errorf("open config %s: %w", path, err)
	}
	defer f.Close()

	kv, err := ParseFlatYAML(f)
	if err != nil {
		return cfg, fmt.Errorf("parse config %s: %w", path, err)
	}
	if err := cfg.applyMap(kv); err != nil {
		return cfg, fmt.Errorf("config %s: %w", path, err)
	}
	return cfg, nil
}

// applyMap overlays a parsed key/value map onto the config. Unknown keys are
// ignored so a newer config file never breaks an older binary.
func (c *Config) applyMap(kv map[string]string) error {
	for key, val := range kv {
		switch normaliseKey(key) {
		case "server":
			if val != "" {
				c.Server = val
			}
		case "token":
			if val != "" {
				c.Token = val
			}
		case "name":
			if val != "" {
				c.Name = val
			}
		case "region":
			c.Region = val
		case "interval":
			n, err := strconv.Atoi(strings.TrimSpace(val))
			if err != nil {
				return fmt.Errorf("interval: %q is not a number", val)
			}
			c.Interval = n
		case "tls_skip_verify":
			b, err := ParseBool(val)
			if err != nil {
				return fmt.Errorf("tls_skip_verify: %w", err)
			}
			c.TLSSkipVerify = b
		default:
			// Ignore unknown keys (forward compatibility).
		}
	}
	return nil
}

// ApplyEnv overlays VPSDOG_* environment variables onto the config.
func (c *Config) ApplyEnv() error {
	if v, ok := os.LookupEnv(EnvServer); ok && strings.TrimSpace(v) != "" {
		c.Server = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvToken); ok && strings.TrimSpace(v) != "" {
		c.Token = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvName); ok && strings.TrimSpace(v) != "" {
		c.Name = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvRegion); ok && strings.TrimSpace(v) != "" {
		c.Region = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvTLS); ok && strings.TrimSpace(v) != "" {
		b, err := ParseBool(v)
		if err != nil {
			return fmt.Errorf("env %s: %w", EnvTLS, err)
		}
		c.TLSSkipVerify = b
	}
	return nil
}

// Normalize trims trailing slashes from the server URL and clamps the
// interval into the 10..3600 s range required by contract §6.
func (c *Config) Normalize() {
	c.Server = strings.TrimRight(strings.TrimSpace(c.Server), "/")
	c.Token = strings.TrimSpace(c.Token)
	c.Name = strings.TrimSpace(c.Name)
	c.Region = strings.TrimSpace(c.Region)
	c.Interval = ClampInterval(c.Interval)
}

// ClampInterval clamps a report interval to the 10..3600 second range.
func ClampInterval(sec int) int {
	if sec <= 0 {
		return 30
	}
	if sec < 10 {
		return 10
	}
	if sec > 3600 {
		return 3600
	}
	return sec
}

// Validate reports configuration problems that make reporting impossible.
func (c *Config) Validate() error {
	if c.Server == "" {
		return fmt.Errorf("server is required (set -server, %s, or `server:` in the config file)", EnvServer)
	}
	if c.Token == "" {
		return fmt.Errorf("token is required (set -token, %s, or `token:` in the config file)", EnvToken)
	}
	if !strings.HasPrefix(c.Server, "http://") && !strings.HasPrefix(c.Server, "https://") {
		return fmt.Errorf("server %q must start with http:// or https://", c.Server)
	}
	return nil
}

// ── tiny flat-YAML parser ────────────────────────────────────────────────

// ParseFlatYAML reads `key: value` lines. It supports:
//   - comments (`#` at the start of a line or after a value)
//   - single- and double-quoted values, including `#` inside quotes
//   - bare scalars (strings, ints, booleans)
//
// It deliberately does NOT support nested mappings, lists, anchors, or
// multi-line scalars — the contract's config is flat.
func ParseFlatYAML(r interface{ Read([]byte) (int, error) }) (map[string]string, error) {
	kv := make(map[string]string, 8)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "---") {
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			return nil, fmt.Errorf("line %d: expected `key: value`, got %q", lineNo, line)
		}
		key = normaliseKey(key)
		if key == "" {
			return nil, fmt.Errorf("line %d: empty key", lineNo)
		}
		val, err := parseScalar(strings.TrimSpace(val))
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNo, err)
		}
		kv[key] = val
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return kv, nil
}

// parseScalar strips quotes and trailing comments.
func parseScalar(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	switch s[0] {
	case '"', '\'':
		quote := s[0]
		end := strings.IndexByte(s[1:], quote)
		if end < 0 {
			return "", fmt.Errorf("unterminated quoted value %s", s)
		}
		raw := s[1 : 1+end]
		if quote == '"' {
			if unq, err := strconv.Unquote(`"` + raw + `"`); err == nil {
				return unq, nil
			}
		}
		return raw, nil
	default:
		if i := strings.Index(s, " #"); i >= 0 {
			s = s[:i]
		}
		return strings.TrimSpace(s), nil
	}
}

// ParseBool accepts the usual YAML/flag boolean spellings.
func ParseBool(s string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "t", "true", "yes", "y", "on":
		return true, nil
	case "0", "f", "false", "no", "n", "off":
		return false, nil
	}
	return false, fmt.Errorf("%q is not a boolean", s)
}

func normaliseKey(k string) string {
	return strings.ToLower(strings.TrimSpace(strings.Trim(k, `"'`)))
}
