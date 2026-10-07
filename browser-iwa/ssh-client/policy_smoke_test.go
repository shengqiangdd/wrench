//go:build iwa_smoke

package main

import "testing"

func TestSmokeBuildAllowsConfiguredPrivatePort(t *testing.T) {
	if !allowedTarget("192.168.1.10", 22222) {
		t.Fatal("smoke build should allow an ephemeral port for a private target")
	}
	if allowedTarget("8.8.8.8", 22222) {
		t.Fatal("smoke build must still reject public IP addresses")
	}
}
