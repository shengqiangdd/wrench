package main

import "testing"

func TestAllowedTarget(t *testing.T) {
	allowed := []string{"10.0.0.1", "172.16.1.2", "172.31.255.254", "192.168.1.10", "fc00::1", "fdab:1234::7"}
	for _, host := range allowed {
		if !allowedTarget(host, 22) {
			t.Errorf("expected allowed private target %q", host)
		}
	}
	blocked := []struct {
		host string
		port int
	}{
		{"8.8.8.8", 22}, {"127.0.0.1", 22}, {"169.254.169.254", 22}, {"fe80::1", 22},
		{"::ffff:192.168.1.2", 22}, {"host.local", 22}, {"0.0.0.0", 22},
	}
	for _, target := range blocked {
		if allowedTarget(target.host, target.port) {
			t.Errorf("unexpectedly allowed %s:%d", target.host, target.port)
		}
	}
}

func TestHostFingerprint(t *testing.T) {
	const expected = "SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU"
	if got := hostFingerprint(nil); got != expected {
		t.Fatalf("empty key fingerprint = %q, want %q", got, expected)
	}
}
