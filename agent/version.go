package main

// Version is the agent version reported to the server in every report.
//
// It is a var (not a const) so release builds can stamp it with:
//
//	go build -ldflags "-X main.Version=1.2.3"
var Version = "1.0.0"
