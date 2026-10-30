package collector

// MetricSample is the shared DTO defined by docs/CONTRACT.md §3.
// The JSON tags MUST match the contract exactly — the worker stores this
// object verbatim as `nodes.latest` and inserts its fields into `metrics`.
type MetricSample struct {
	CPU       float64 `json:"cpu"`        // 0-100
	MemUsed   uint64  `json:"mem_used"`   // bytes
	MemTotal  uint64  `json:"mem_total"`  // bytes
	SwapUsed  uint64  `json:"swap_used"`  // bytes
	SwapTotal uint64  `json:"swap_total"` // bytes
	DiskUsed  uint64  `json:"disk_used"`  // bytes
	DiskTotal uint64  `json:"disk_total"` // bytes
	NetIn     uint64  `json:"net_in"`     // cumulative bytes since boot
	NetOut    uint64  `json:"net_out"`    // cumulative bytes since boot
	RxRate    float64 `json:"rx_rate"`    // bytes/sec over the last interval
	TxRate    float64 `json:"tx_rate"`    // bytes/sec over the last interval
	TCP       int     `json:"tcp"`
	UDP       int     `json:"udp"`
	Process   int     `json:"process"`
	Uptime    uint64  `json:"uptime"` // seconds
	Load1     float64 `json:"load1"`
	Load5     float64 `json:"load5"`
	Load15    float64 `json:"load15"`
}

// Host describes the machine, reported once on first contact (§4.1).
// CPU model / core count ride along in the same envelope: they are static
// facts, and the worker stores them into `nodes.host_info`.
type Host struct {
	OS       string `json:"os,omitempty"`
	Arch     string `json:"arch,omitempty"`
	Region   string `json:"region,omitempty"`
	CPUModel string `json:"cpu_model,omitempty"`
	CPUCores int    `json:"cpu_cores,omitempty"`
}
