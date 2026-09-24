package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"

	"golang.org/x/crypto/ssh"
)

const port = 22

type config struct {
	Address  string `json:"address"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func main() {
	if err := serve(); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR", err)
		os.Exit(1)
	}
}

func serve() error {
	var cfg config
	if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&cfg); err != nil {
		return fmt.Errorf("read test configuration: %w", err)
	}
	if !isRFC1918(cfg.Address) || cfg.Username == "" || cfg.Password == "" {
		return errors.New("private IPv4 address, username, and password are required")
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
		go handle(connection, cfg, signer)
	}
}

func handle(connection net.Conn, cfg config, signer ssh.Signer) {
	serverConfig := &ssh.ServerConfig{
		PasswordCallback: func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			userOK := subtle.ConstantTimeCompare([]byte(meta.User()), []byte(cfg.Username)) == 1
			passwordOK := subtle.ConstantTimeCompare(password, []byte(cfg.Password)) == 1
			if !userOK || !passwordOK {
				return nil, ssh.ErrNoAuth
			}
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
		switch request.Type {
		case "pty-req":
			_ = request.Reply(true, nil)
		case "shell":
			_ = request.Reply(true, nil)
			_, _ = io.WriteString(channel, "READY\r\n")
			_, _ = io.Copy(channel, channel)
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
