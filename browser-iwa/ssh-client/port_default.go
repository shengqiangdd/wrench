//go:build !iwa_smoke

package main

func allowedPort(port int) bool {
	return port == 22
}
