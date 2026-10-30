package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/heshang2011/vps-dog/agent/internal/client"
	"github.com/heshang2011/vps-dog/agent/internal/collector"
	"github.com/heshang2011/vps-dog/agent/internal/config"
	"github.com/heshang2011/vps-dog/agent/internal/probe"
)

func TestMockRoundTrip(t *testing.T) {
	var gotAuth, gotCT string
	var body client.ReportRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/report" {
			t.Errorf("path = %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true, "node_id": "node-1", "server_time": 1760000000,
			"interval": 15,
			"pings": []map[string]any{
				{"id": "p1", "name": "cloudflare", "type": "tcp", "target": "1.1.1.1:443", "interval": 60},
			},
		})
	}))
	defer srv.Close()

	cl := client.New(client.Config{Server: srv.URL, Token: "tok123", Name: "hk-01", Version: "1.0.0"})
	resp, err := cl.Report(context.Background(), client.ReportRequest{
		Metrics: collector.MetricSample{CPU: 12.5, MemTotal: 100},
		Pings:   []probe.Result{{Name: "a", Type: "tcp", Target: "1.1.1.1:443", Value: 12.3, OK: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer tok123" {
		t.Errorf("auth = %q", gotAuth)
	}
	if gotCT != "application/json" {
		t.Errorf("content-type = %q", gotCT)
	}
	if body.Name != "hk-01" || body.Version != "1.0.0" {
		t.Errorf("envelope = %+v", body)
	}
	if body.Metrics.CPU != 12.5 || body.Metrics.MemTotal != 100 {
		t.Errorf("metrics = %+v", body.Metrics)
	}
	if len(body.Pings) != 1 || body.Pings[0].OK != 1 {
		t.Errorf("pings = %+v", body.Pings)
	}
	if resp.Interval != 15 || resp.NodeID != "node-1" || len(resp.Pings) != 1 {
		t.Errorf("resp = %+v", resp)
	}
	if resp.Pings[0].Target != "1.1.1.1:443" || resp.Pings[0].Interval != 60 {
		t.Errorf("tasks = %+v", resp.Pings[0])
	}
}

func TestMetricsJSONTags(t *testing.T) {
	b, err := json.Marshal(collector.MetricSample{CPU: 1, NetIn: 2})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"cpu", "mem_used", "mem_total", "swap_used", "swap_total",
		"disk_used", "disk_total", "net_in", "net_out", "rx_rate", "tx_rate",
		"tcp", "udp", "process", "uptime", "load1", "load5", "load15"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing metric key %q", k)
		}
	}
	if len(m) != 18 {
		t.Errorf("got %d keys, want 18", len(m))
	}
}

func TestConfigParser(t *testing.T) {
	cases := []struct{ in, want string }{
		{"server: \"https://x.dev\"\n", "https://x.dev"},
		{"server: https://x.dev  # comment\n", "https://x.dev"},
		{"server: 'https://x.dev'\n", "https://x.dev"},
		{"# c\n\nserver:   https://x.dev\n", "https://x.dev"},
	}
	for _, c := range cases {
		kv, err := config.ParseFlatYAML(strings.NewReader(c.in))
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if kv["server"] != c.want {
			t.Errorf("%q -> %q, want %q", c.in, kv["server"], c.want)
		}
	}
	kv, _ := config.ParseFlatYAML(strings.NewReader("interval: 45\ntls_skip_verify: true\nregion: HK\n"))
	if kv["interval"] != "45" || kv["tls_skip_verify"] != "true" || kv["region"] != "HK" {
		t.Errorf("kv = %+v", kv)
	}
	if config.ClampInterval(1) != 10 || config.ClampInterval(99999) != 3600 || config.ClampInterval(30) != 30 {
		t.Error("clamp")
	}
}

func TestProbeFailures(t *testing.T) {
	if v, ok := probe.TCP("127.0.0.1:1", 0); ok || v != -1 {
		t.Errorf("tcp to closed port: %v %v", v, ok)
	}
	if v, ok := probe.HTTP("http://127.0.0.1:1/", 0, false); ok || v != -1 {
		t.Errorf("http to closed port: %v %v", v, ok)
	}
	if r := probe.Run(probe.Task{Name: "x", Type: "bogus", Target: "y"}); r.OK != 0 || r.Value != -1 {
		t.Errorf("unknown type = %+v", r)
	}
	// A live HTTP probe must succeed and be >= 0.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()
	if v, ok := probe.HTTP(srv.URL, 0, false); !ok || v < 0 {
		t.Errorf("live http probe = %v %v", v, ok)
	}
	// 404 counts as a failure with value -1.
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
	}))
	defer srv2.Close()
	if v, ok := probe.HTTP(srv2.URL, 0, false); ok || v != -1 {
		t.Errorf("404 http probe = %v %v", v, ok)
	}
}

func TestCollectorNoPanic(t *testing.T) {
	col := collector.New()
	s, err := col.Collect()
	if err != nil {
		t.Logf("collect returned partial: %v", err)
	}
	s2, err := col.Collect()
	if err != nil {
		t.Logf("collect returned partial: %v", err)
	}
	t.Logf("sample1=%+v\nsample2=%+v", s, s2)
	if h := col.Host(); h.Arch == "" || h.OS == "" {
		t.Errorf("host = %+v", h)
	}
}
