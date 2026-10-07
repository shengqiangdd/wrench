//go:build iwa_smoke

package main

func allowedPort(port int) bool {
	return port >= 1 && port <= 65535
}
