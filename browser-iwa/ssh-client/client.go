package main

import (
	"errors"
	"fmt"
	"net"

	"golang.org/x/crypto/ssh"
)

type HostKeyConfirmer func(keyType, fingerprint string) bool

// newSSHClient performs SSH negotiation and password authentication only after the supplied
// callback accepts the server's SHA-256 host-key fingerprint.
func newSSHClient(conn net.Conn, address, username, password string, confirm HostKeyConfirmer) (*ssh.Client, error) {
	if password == "" {
		return nil, errors.New("SSH password is required")
	}
	return newSSHClientWithAuth(conn, address, username, ssh.Password(password), confirm)
}

// parseUserPrivateKey accepts OpenSSH and PEM private keys supported by x/crypto/ssh.
// It restricts key types to Ed25519, ECDSA, and RSA; RSA user authentication uses
// x/crypto/ssh's negotiated SHA-2 signatures rather than RSA/SHA-1.
func parseUserPrivateKey(privateKey, passphrase []byte) (ssh.Signer, error) {
	if len(privateKey) == 0 {
		return nil, errors.New("SSH private key is required")
	}

	var (
		signer ssh.Signer
		err    error
	)
	if len(passphrase) > 0 {
		signer, err = ssh.ParsePrivateKeyWithPassphrase(privateKey, passphrase)
	} else {
		signer, err = ssh.ParsePrivateKey(privateKey)
	}
	if err != nil {
		var missingPassphrase *ssh.PassphraseMissingError
		if errors.As(err, &missingPassphrase) {
			return nil, errors.New("SSH private key is encrypted; enter its passphrase")
		}
		return nil, fmt.Errorf("parse SSH private key: %w", err)
	}

	switch signer.PublicKey().Type() {
	case ssh.KeyAlgoED25519, ssh.KeyAlgoRSA, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521:
		return signer, nil
	default:
		return nil, fmt.Errorf("unsupported SSH private key type %q", signer.PublicKey().Type())
	}
}

func newSSHClientWithPrivateKey(conn net.Conn, address, username string, privateKey, passphrase []byte, confirm HostKeyConfirmer) (*ssh.Client, error) {
	signer, err := parseUserPrivateKey(privateKey, passphrase)
	if err != nil {
		return nil, err
	}
	return newSSHClientWithAuth(conn, address, username, ssh.PublicKeys(signer), confirm)
}

func newSSHClientWithAuth(conn net.Conn, address, username string, auth ssh.AuthMethod, confirm HostKeyConfirmer) (*ssh.Client, error) {
	if confirm == nil {
		return nil, errors.New("host-key confirmation callback is required")
	}
	if auth == nil {
		return nil, errors.New("SSH authentication method is required")
	}
	config := secureSSHClientConfigWithAuth(username, auth, confirm)
	sshConn, channels, requests, err := ssh.NewClientConn(conn, address, config)
	if err != nil {
		return nil, err
	}
	return ssh.NewClient(sshConn, channels, requests), nil
}

func secureSSHClientConfig(username, password string, confirm HostKeyConfirmer) *ssh.ClientConfig {
	return secureSSHClientConfigWithAuth(username, ssh.Password(password), confirm)
}

func secureSSHClientConfigWithAuth(username string, auth ssh.AuthMethod, confirm HostKeyConfirmer) *ssh.ClientConfig {
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
		Auth: []ssh.AuthMethod{auth},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			if !confirm(key.Type(), hostFingerprint(key.Marshal())) {
				return fmt.Errorf("host key rejected by user")
			}
			return nil
		},
	}
}
