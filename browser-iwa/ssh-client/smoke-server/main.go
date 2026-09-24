package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const port = 22

type config struct {
	Address       string `json:"address"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	AuthorizedKey string `json:"authorized_key"`
}

func main() {
	var err error
	if len(os.Args) == 2 && os.Args[1] == "keygen" {
		err = generateClientKey()
	} else if len(os.Args) == 1 {
		err = serve()
	} else {
		err = errors.New("usage: smoke-server [keygen]")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR", err)
		os.Exit(1)
	}
}

func generateClientKey() error {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return err
	}
	absoluteDirectory, err := filepath.Abs(workingDirectory)
	if err != nil {
		return err
	}
	if filepath.Dir(absoluteDirectory) != filepath.Clean(os.TempDir()) ||
		!strings.HasPrefix(filepath.Base(absoluteDirectory), "wrench-iwa-signed-smoke-") {
		return errors.New("keygen is restricted to the smoke test's unique temporary directory")
	}
	var cfg struct {
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&cfg); err != nil {
		return fmt.Errorf("read keygen configuration: %w", err)
	}
	if cfg.Passphrase == "" {
		return errors.New("test key passphrase is required")
	}
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generate ephemeral SSH user key: %w", err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(privateKey, "wrench smoke test", []byte(cfg.Passphrase))
	if err != nil {
		return fmt.Errorf("encrypt ephemeral SSH user key: %w", err)
	}
	file, err := os.OpenFile("ssh-login-key", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create ephemeral private key: %w", err)
	}
	if _, err := file.Write(pem.EncodeToMemory(block)); err != nil {
		_ = file.Close()
		return fmt.Errorf("write ephemeral private key: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close ephemeral private key: %w", err)
	}
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		return fmt.Errorf("create ephemeral public key: %w", err)
	}
	_, err = os.Stdout.Write(ssh.MarshalAuthorizedKey(signer.PublicKey()))
	return err
}

func serve() error {
	var cfg config
	if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&cfg); err != nil {
		return fmt.Errorf("read test configuration: %w", err)
	}
	if !isRFC1918(cfg.Address) || cfg.Username == "" || cfg.Password == "" || cfg.AuthorizedKey == "" {
		return errors.New("private IPv4 address, username, password, and authorized key are required")
	}
	authorizedKey, _, _, _, err := ssh.ParseAuthorizedKey([]byte(cfg.AuthorizedKey))
	if err != nil {
		return fmt.Errorf("parse test authorized key: %w", err)
	}

	listener, err := net.Listen("tcp", net.JoinHostPort(cfg.Address, strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("listen on %s:%d: %w", cfg.Address, port, err)
	}
	defer listener.Close()

	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generate ephemeral SSH host key: %w", err)
	}
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		return fmt.Errorf("create SSH signer: %w", err)
	}
	fmt.Printf("READY %s\n", ssh.FingerprintSHA256(signer.PublicKey()))

	for {
		connection, err := listener.Accept()
		if err != nil {
			return fmt.Errorf("accept TCP: %w", err)
		}
		fmt.Println("ACCEPT")
		go handle(connection, cfg, signer, authorizedKey)
	}
}

func handle(connection net.Conn, cfg config, signer ssh.Signer, authorizedKey ssh.PublicKey) {
	serverConfig := &ssh.ServerConfig{
		PublicKeyCallback: func(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if meta.User() != cfg.Username || subtle.ConstantTimeCompare(key.Marshal(), authorizedKey.Marshal()) != 1 {
				return nil, ssh.ErrNoAuth
			}
			fmt.Println("AUTH publickey")
			return nil, nil
		},
		PasswordCallback: func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			userOK := subtle.ConstantTimeCompare([]byte(meta.User()), []byte(cfg.Username)) == 1
			passwordOK := subtle.ConstantTimeCompare(password, []byte(cfg.Password)) == 1
			if !userOK || !passwordOK {
				return nil, ssh.ErrNoAuth
			}
			fmt.Println("AUTH password")
			return nil, nil
		},
	}
	serverConfig.AddHostKey(signer)
	server, channels, requests, err := ssh.NewServerConn(connection, serverConfig)
	if err != nil {
		_ = connection.Close()
		return
	}
	defer server.Close()
	go ssh.DiscardRequests(requests)

	for request := range channels {
		channel, channelRequests, err := request.Accept()
		if err != nil {
			continue
		}
		go handleChannel(channel, channelRequests)
	}
}

func handleChannel(channel ssh.Channel, requests <-chan *ssh.Request) {
	defer channel.Close()
	for request := range requests {
		fmt.Printf("CHANNEL REQUEST %s\n", request.Type)
		switch request.Type {
		case "pty-req":
			_ = request.Reply(true, nil)
		case "shell":
			_ = request.Reply(true, nil)
			_, _ = io.WriteString(channel, "READY\r\n")
			_, _ = io.Copy(channel, channel)
			return
		case "subsystem":
			var subsystemRequest struct {
				Subsystem string
			}
			if err := ssh.Unmarshal(request.Payload, &subsystemRequest); err != nil || subsystemRequest.Subsystem != "sftp" {
				fmt.Printf("SFTP subsystem rejected: %q\n", subsystemRequest.Subsystem)
				_ = request.Reply(false, nil)
				continue
			}
			fmt.Println("SFTP subsystem accepted")
			_ = request.Reply(true, nil)
			handlers, err := sftp.InMemHandlerWithSymlink(".", "/browser-symlink-dir")
			if err != nil {
				fmt.Printf("SFTP fixture setup failed: %v\n", err)
				return
			}
			server := sftp.NewRequestServer(channel, handlers)
			_ = server.Serve()
			_ = server.Close()
			return
		default:
			_ = request.Reply(false, nil)
		}
	}
}

func isRFC1918(address string) bool {
	ip := net.ParseIP(address).To4()
	if ip == nil {
		return false
	}
	return ip[0] == 10 ||
		(ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) ||
		(ip[0] == 192 && ip[1] == 168)
}
