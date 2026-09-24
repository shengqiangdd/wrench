package main

import (
	"crypto/ed25519"
	"crypto/rand"
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
		serverDone <- conn.Close()
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
