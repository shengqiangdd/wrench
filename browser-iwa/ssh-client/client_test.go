package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/hex"
	"encoding/pem"
	"io"
	"net"
	"strings"
	"testing"
	"time"

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
	windowChangeReceived := make(chan [2]uint32, 1)
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
					switch request.Type {
					case "pty-req", "shell":
						_ = request.Reply(true, nil)
						if request.Type == "shell" {
							_, _ = io.WriteString(channel, "ready\r\n")
							go io.Copy(io.Discard, channel)
						}
					case "window-change":
						var dimensions struct {
							Columns uint32
							Rows    uint32
							Width   uint32
							Height  uint32
						}
						if unmarshalErr := ssh.Unmarshal(request.Payload, &dimensions); unmarshalErr != nil {
							t.Errorf("decode window-change request: %v", unmarshalErr)
							continue
						}
						windowChangeReceived <- [2]uint32{dimensions.Columns, dimensions.Rows}
					default:
						_ = request.Reply(false, nil)
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
	if err := requestTerminalResize(session, 123, 45); err != nil {
		t.Fatalf("request terminal resize: %v", err)
	}
	select {
	case dimensions := <-windowChangeReceived:
		if dimensions != [2]uint32{123, 45} {
			t.Fatalf("remote window dimensions = %v; want [123 45]", dimensions)
		}
	case <-time.After(time.Second):
		t.Fatal("server did not receive the SSH window-change request")
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

func randomTestPassphrase(t *testing.T) string {
	t.Helper()
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(value)
}

func TestParseUserPrivateKeySupportsOpenSSHAndEncryptedKeys(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	plainBlock, err := ssh.MarshalPrivateKey(privateKey, "local IWA test")
	if err != nil {
		t.Fatal(err)
	}
	plainPEM := pem.EncodeToMemory(plainBlock)
	plainSigner, err := parseUserPrivateKey(plainPEM, nil)
	if err != nil {
		t.Fatalf("parse unencrypted OpenSSH key: %v", err)
	}
	if plainSigner.PublicKey().Type() != ssh.KeyAlgoED25519 {
		t.Fatalf("key type = %q, want Ed25519", plainSigner.PublicKey().Type())
	}

	passphrase := randomTestPassphrase(t)
	encryptedBlock, err := ssh.MarshalPrivateKeyWithPassphrase(privateKey, "local IWA test", []byte(passphrase))
	if err != nil {
		t.Fatal(err)
	}
	encryptedPEM := pem.EncodeToMemory(encryptedBlock)
	if _, err := parseUserPrivateKey(encryptedPEM, nil); err == nil {
		t.Fatal("encrypted key was accepted without its passphrase")
	} else if !strings.Contains(err.Error(), "encrypted") {
		t.Fatalf("missing-passphrase error = %q", err)
	}
	if _, err := parseUserPrivateKey(encryptedPEM, []byte("wrong passphrase")); err == nil {
		t.Fatal("encrypted key was accepted with an incorrect passphrase")
	}
	if _, err := parseUserPrivateKey(encryptedPEM, []byte(passphrase)); err != nil {
		t.Fatalf("parse encrypted OpenSSH key: %v", err)
	}
	if _, err := parseUserPrivateKey([]byte("not a private key"), nil); err == nil {
		t.Fatal("malformed private key was accepted")
	}
}

func TestNewSSHClientWithPrivateKeyAuthenticates(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	passphrase := randomTestPassphrase(t)
	privateBlock, err := ssh.MarshalPrivateKeyWithPassphrase(privateKey, "local IWA test", []byte(passphrase))
	if err != nil {
		t.Fatal(err)
	}
	privateKeyPEM := pem.EncodeToMemory(privateBlock)
	authorizedSigner, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig := testServerConfig(t)
	serverConfig.PasswordCallback = nil
	serverConfig.PublicKeyCallback = func(metadata ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
		if metadata.User() != "alice" || !bytes.Equal(key.Marshal(), authorizedSigner.PublicKey().Marshal()) {
			return nil, ssh.ErrNoAuth
		}
		return nil, nil
	}

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
		server, _, _, handshakeErr := ssh.NewServerConn(serverConn, serverConfig)
		if handshakeErr != nil {
			serverDone <- handshakeErr
			return
		}
		serverDone <- server.Wait()
	}()

	approved := false
	client, err := newSSHClientWithPrivateKey(clientConn, "192.168.1.8:22", "alice", privateKeyPEM, []byte(passphrase), func(keyType, fingerprint string) bool {
		if keyType != ssh.KeyAlgoED25519 {
			t.Errorf("host key type = %q, want Ed25519", keyType)
		}
		if fingerprint == "" {
			t.Error("empty host-key fingerprint")
		}
		approved = true
		return true
	})
	if err != nil {
		t.Fatalf("private-key SSH authentication failed: %v", err)
	}
	if !approved {
		t.Fatal("host key was not confirmed before authentication")
	}
	if err := client.Close(); err != nil {
		t.Errorf("close SSH client: %v", err)
	}
	<-serverDone
}
