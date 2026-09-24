package main

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"io"
	"net"
	"testing"

	"golang.org/x/crypto/ssh"
)

func testServerConfig(t *testing.T) *ssh.ServerConfig {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return testServerConfigWithSigner(t, signer)
}

func testServerConfigWithSigner(t *testing.T, signer ssh.Signer) *ssh.ServerConfig {
	t.Helper()
	config := &ssh.ServerConfig{PasswordCallback: func(metadata ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
		if metadata.User() != "alice" || string(password) != "correct horse" {
			return nil, ssh.ErrNoAuth
		}
		return nil, nil
	}}
	config.AddHostKey(signer)
	return config
}

func TestNewSSHClientRequiresAcceptedHostKeyAndAuthenticates(t *testing.T) {
	serverConfig := testServerConfig(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	clientConn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan error, 1)
	go func() {
		serverConn, acceptErr := listener.Accept()
		if acceptErr != nil {
			serverDone <- acceptErr
			return
		}
		conn, channels, requests, err := ssh.NewServerConn(serverConn, serverConfig)
		if err != nil {
			serverDone <- err
			return
		}
		go ssh.DiscardRequests(requests)
		for channelRequest := range channels {
			channel, requests, err := channelRequest.Accept()
			if err != nil {
				continue
			}
			go func() {
				for request := range requests {
					accepted := request.Type == "pty-req" || request.Type == "shell"
					_ = request.Reply(accepted, nil)
					if request.Type == "shell" {
						_, _ = io.WriteString(channel, "ready\r\n")
						go io.Copy(io.Discard, channel)
						return
					}
				}
			}()
		}
		serverDone <- conn.Wait()
	}()

	approvedFingerprint := ""
	client, err := newSSHClient(clientConn, "192.168.1.8:22", "alice", "correct horse", func(keyType, fingerprint string) bool {
		if keyType != "ssh-ed25519" {
			t.Errorf("unexpected host key type %q", keyType)
		}
		approvedFingerprint = fingerprint
		return true
	})
	if err != nil {
		t.Fatal(err)
	}
	if approvedFingerprint == "" {
		t.Fatal("host key callback was not invoked")
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	stdout, err := session.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := session.RequestPty("xterm-256color", 24, 80, nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Shell(); err != nil {
		t.Fatal(err)
	}
	line := make([]byte, len("ready\r\n"))
	if _, err := io.ReadFull(stdout, line); err != nil {
		t.Fatal(err)
	}
	if string(line) != "ready\r\n" {
		t.Fatalf("shell output = %q", line)
	}
}

func TestNewSSHClientRejectsHostKeyAndRequiresConfirmer(t *testing.T) {
	if _, err := newSSHClient(nil, "host:22", "alice", "password", nil); err == nil {
		t.Fatal("nil host-key callback accepted")
	}
	serverConfig := testServerConfig(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	clientConn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		serverConn, err := listener.Accept()
		if err == nil {
			_, _, _, _ = ssh.NewServerConn(serverConn, serverConfig)
		}
	}()
	_, err = newSSHClient(clientConn, "192.168.1.8:22", "alice", "correct horse", func(_, _ string) bool { return false })
	if err == nil {
		t.Fatal("unapproved host key was accepted")
	}
}

func TestHostKeyAlgorithmInteroperability(t *testing.T) {
	tests := []struct {
		name    string
		keyType string
		newKey  func() (any, error)
	}{
		{name: "ed25519", keyType: "ssh-ed25519", newKey: func() (any, error) { _, key, err := ed25519.GenerateKey(rand.Reader); return key, err }},
		{name: "ecdsa-p256", keyType: "ecdsa-sha2-nistp256", newKey: func() (any, error) { return ecdsa.GenerateKey(elliptic.P256(), rand.Reader) }},
		{name: "rsa-sha2", keyType: "ssh-rsa", newKey: func() (any, error) { return rsa.GenerateKey(rand.Reader, 2048) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			privateKey, err := tc.newKey()
			if err != nil {
				t.Fatal(err)
			}
			signer, err := ssh.NewSignerFromKey(privateKey)
			if err != nil {
				t.Fatal(err)
			}
			serverConfig := testServerConfigWithSigner(t, signer)
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			clientConn, err := net.Dial("tcp", listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			serverDone := make(chan error, 1)
			go func() {
				serverConn, err := listener.Accept()
				if err != nil {
					serverDone <- err
					return
				}
				conn, _, requests, err := ssh.NewServerConn(serverConn, serverConfig)
				if err != nil {
					serverDone <- err
					return
				}
				go ssh.DiscardRequests(requests)
				serverDone <- conn.Wait()
			}()
			client, err := newSSHClient(clientConn, "192.168.1.8:22", "alice", "correct horse", func(keyType, fingerprint string) bool {
				if keyType != tc.keyType {
					t.Errorf("key type = %q, want %q", keyType, tc.keyType)
				}
				if fingerprint == "" {
					t.Error("empty SHA-256 fingerprint")
				}
				return true
			})
			if err != nil {
				t.Fatalf("SSH handshake failed: %v", err)
			}
			_ = client.Close()
			<-serverDone
		})
	}
}

func TestSecureSSHConfigExcludesLegacyAlgorithms(t *testing.T) {
	config := secureSSHClientConfig("alice", "password", func(string, string) bool { return true })
	contains := func(list []string, item string) bool {
		for _, candidate := range list {
			if candidate == item {
				return true
			}
		}
		return false
	}
	for _, forbidden := range []struct {
		name      string
		values    []string
		algorithm string
	}{
		{"host key", config.HostKeyAlgorithms, ssh.KeyAlgoRSA},
		{"host key", config.HostKeyAlgorithms, ssh.InsecureKeyAlgoDSA},
		{"key exchange", config.KeyExchanges, ssh.InsecureKeyExchangeDH14SHA1},
		{"key exchange", config.KeyExchanges, ssh.InsecureKeyExchangeDH1SHA1},
		{"cipher", config.Ciphers, ssh.InsecureCipherAES128CBC},
		{"cipher", config.Ciphers, ssh.InsecureCipherTripleDESCBC},
		{"cipher", config.Ciphers, ssh.InsecureCipherRC4},
		{"MAC", config.MACs, ssh.HMACSHA1},
		{"MAC", config.MACs, ssh.InsecureHMACSHA196},
	} {
		if contains(forbidden.values, forbidden.algorithm) {
			t.Errorf("legacy %s algorithm %q is enabled", forbidden.name, forbidden.algorithm)
		}
	}
	for _, required := range []struct {
		name      string
		values    []string
		algorithm string
	}{
		{"host key", config.HostKeyAlgorithms, ssh.KeyAlgoED25519},
		{"host key", config.HostKeyAlgorithms, ssh.KeyAlgoRSASHA256},
		{"key exchange", config.KeyExchanges, ssh.KeyExchangeCurve25519},
		{"cipher", config.Ciphers, ssh.CipherAES128GCM},
		{"MAC", config.MACs, ssh.HMACSHA256ETM},
	} {
		if !contains(required.values, required.algorithm) {
			t.Errorf("secure %s algorithm %q is missing", required.name, required.algorithm)
		}
	}
}
