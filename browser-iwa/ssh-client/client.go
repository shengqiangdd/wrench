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
	config := secureSSHClientConfig(username, password, confirm)
	sshConn, channels, requests, err := ssh.NewClientConn(conn, address, config)
	if err != nil {
		return nil, err
	}
	return ssh.NewClient(sshConn, channels, requests), nil
}

func secureSSHClientConfig(username, password string, confirm HostKeyConfirmer) *ssh.ClientConfig {
	return &ssh.ClientConfig{
		Config: ssh.Config{
			KeyExchanges: []string{
				ssh.KeyExchangeMLKEM768X25519, ssh.KeyExchangeCurve25519,
				ssh.KeyExchangeECDHP256, ssh.KeyExchangeECDHP384, ssh.KeyExchangeECDHP521,
				ssh.KeyExchangeDH14SHA256, ssh.KeyExchangeDH16SHA512, ssh.KeyExchangeDHGEXSHA256,
			},
			Ciphers: []string{
				ssh.CipherChaCha20Poly1305, ssh.CipherAES256GCM, ssh.CipherAES128GCM,
				ssh.CipherAES256CTR, ssh.CipherAES192CTR, ssh.CipherAES128CTR,
			},
			MACs: []string{ssh.HMACSHA512ETM, ssh.HMACSHA256ETM, ssh.HMACSHA512, ssh.HMACSHA256},
		},
		HostKeyAlgorithms: []string{
			ssh.KeyAlgoED25519, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521,
			ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256,
		},
		User: username,
		Auth: []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			if !confirm(key.Type(), hostFingerprint(key.Marshal())) {
				return fmt.Errorf("host key rejected by user")
			}
			return nil
		},
	}
}
