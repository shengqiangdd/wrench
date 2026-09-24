package main

import (
	"crypto/sha256"
	"encoding/base64"
	"net/netip"
	"strings"
)

// allowedTarget limits IWA SSH to literal private IPv4 or IPv6 ULA addresses on TCP/22.
func allowedTarget(host string, port int) bool {
	if port != 22 {
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
