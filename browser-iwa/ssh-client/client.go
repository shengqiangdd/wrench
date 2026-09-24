package main

import (
	"fmt"
	"net"

	"golang.org/x/crypto/ssh"
)

type HostKeyConfirmer func(keyType, fingerprint string) bool

// newSSHClient performs SSH negotiation and password authentication only after the supplied
// callback accepts the server's SHA-256 host-key fingerprint.
func newSSHClient(conn net.Conn, address, username, password string, confirm HostKeyConfirmer) (*ssh.Client, error) {
	if confirm == nil {
		return nil, fmt.Errorf("host-key confirmation callback is required")
	}
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			if !confirm(key.Type(), hostFingerprint(key.Marshal())) {
				return fmt.Errorf("host key rejected by user")
			}
			return nil
		},
	}
	sshConn, channels, requests, err := ssh.NewClientConn(conn, address, config)
	if err != nil {
		return nil, err
	}
	return ssh.NewClient(sshConn, channels, requests), nil
}
