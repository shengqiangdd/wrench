package main

import (
	"crypto/sha256"
	"encoding/base64"
	"net/netip"
	"strings"
)

// allowedTarget limits IWA SSH to private IP literals and the configured port.
func allowedTarget(host string, port int) bool {
	if !allowedPort(port) {
		return false
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || ip.Is4In6() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	return ip.IsPrivate()
}

func hostFingerprint(key []byte) string {
	digest := sha256.Sum256(key)
	return "SHA256:" + strings.TrimRight(base64.StdEncoding.EncodeToString(digest[:]), "=")
}
