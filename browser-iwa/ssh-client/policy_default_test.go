//go:build !iwa_smoke

package main

import "testing"

func TestProductionBuildRejectsNonDefaultPort(t *testing.T) {
	if allowedTarget("192.168.1.10", 22222) {
		t.Fatal("production build unexpectedly allowed a non-default SSH port")
	}
}
