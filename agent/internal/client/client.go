// Package client implements the agent half of the report protocol defined in
// docs/CONTRACT.md §4.1 and §6.
package client

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/heshang2011/vps-dog/agent/internal/collector"
	"github.com/heshang2011/vps-dog/agent/internal/probe"
)

// ReportRequest is the POST /api/v1/report body (§4.1).
type ReportRequest struct {
	Name    string                 `json:"name,omitempty"`
	Version string                 `json:"version,omitempty"`
	Host    *collector.Host        `json:"host,omitempty"`
	Metrics collector.MetricSample `json:"metrics"`
	Pings   []probe.Result         `json:"pings,omitempty"`
}

// ReportResponse is the 200 response body (§4.1).
type ReportResponse struct {
	OK         bool         `json:"ok"`
	NodeID     string       `json:"node_id"`
	ServerTime int64        `json:"server_time"`
	Interval   int          `json:"interval"`
	Pings      []probe.Task `json:"pings"`
}

// APIError is returned for non-2xx responses, preserving the worker's
// `{error, message}` envelope (§4).
type APIError struct {
	StatusCode int
	Code       string `json:"error"`
	Message    string `json:"message"`
}

func (e *APIError) Error() string {
	switch {
	case e.Code != "" && e.Message != "":
		return fmt.Sprintf("server returned %d: %s (%s)", e.StatusCode, e.Code, e.Message)
	case e.Code != "":
		return fmt.Sprintf("server returned %d: %s", e.StatusCode, e.Code)
	default:
		return fmt.Sprintf("server returned %d", e.StatusCode)
	}
}

// Unauthorized reports whether the token was rejected (§4.1: 401).
func (e *APIError) Unauthorized() bool { return e.StatusCode == http.StatusUnauthorized }

// Config configures a Client.
type Config struct {
	Server        string // base URL, no trailing slash
	Token         string // bearer token
	Name          string // node name, sent on first contact
	Version       string // agent version
	TLSSkipVerify bool
	Timeout       time.Duration
}

// Client posts reports to the worker.
type Client struct {
	cfg  Config
	http *http.Client
}

// New builds a Client. The HTTP transport keeps a small idle pool so that the
// per-report TLS handshake is not paid every interval.
func New(cfg Config) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	tr := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	if cfg.TLSSkipVerify {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // explicit opt-in via tls_skip_verify
	}
	return &Client{
		cfg:  cfg,
		http: &http.Client{Transport: tr, Timeout: timeout},
	}
}

// Close releases idle connections.
func (c *Client) Close() {
	if c.http != nil {
		c.http.CloseIdleConnections()
	}
}

// Endpoint returns the ingest URL.
func (c *Client) Endpoint() string {
	return strings.TrimRight(c.cfg.Server, "/") + "/api/v1/report"
}

// Report POSTs one sample plus probe results and returns the parsed response.
func (c *Client) Report(ctx context.Context, req ReportRequest) (*ReportResponse, error) {
	if req.Version == "" {
		req.Version = c.cfg.Version
	}
	if req.Name == "" {
		req.Name = c.cfg.Name
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode report: %w", err)
	}

	endpoint := c.Endpoint()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "vps-dog-agent/"+c.cfg.Version)
	httpReq.Header.Set("Authorization", "Bearer "+c.cfg.Token)
	// Sent alongside the bearer header; the worker accepts either (§4.1).
	httpReq.Header.Set("X-Node-Token", c.cfg.Token)

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("post %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	// Cap the body so a misbehaving server cannot exhaust memory.
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := &APIError{StatusCode: resp.StatusCode}
		if len(bytes.TrimSpace(raw)) > 0 {
			_ = json.Unmarshal(raw, apiErr)
		}
		return nil, apiErr
	}

	var out ReportResponse
	if len(bytes.TrimSpace(raw)) == 0 {
		// A 200 with an empty body is unusual but not fatal: keep the last
		// known interval and report no probes.
		return &out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &out, nil
}

// ── retry with exponential backoff ───────────────────────────────────────

// Backoff bounds, per contract §6: 1s → 2s → … → 60s.
const (
	MinBackoff = 1 * time.Second
	MaxBackoff = 60 * time.Second
)

// Backoff returns the delay before retry attempt n (n starts at 1) and the
// next attempt number, doubling up to MaxBackoff.
func Backoff(attempt int) (time.Duration, int) {
	if attempt < 1 {
		attempt = 1
	}
	d := MinBackoff
	for i := 1; i < attempt; i++ {
		if d >= MaxBackoff {
			return MaxBackoff, attempt + 1
		}
		d *= 2
	}
	if d > MaxBackoff {
		d = MaxBackoff
	}
	return d, attempt + 1
}

// Retryable reports whether err is worth retrying. Authentication and
// malformed-body failures are permanent: retrying them forever would just
// spam the server, so the caller logs and keeps its normal cadence.
func Retryable(err error) bool {
	if err == nil {
		return false
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case http.StatusUnauthorized, http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound:
			return false
		}
		return true
	}
	// Transport-level errors (DNS, TLS, timeouts, refused connections) are
	// always retryable.
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return true
	}
	return true
}
