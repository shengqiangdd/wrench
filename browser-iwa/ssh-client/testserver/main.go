package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"os"

	"golang.org/x/crypto/ssh"
)

func main() {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	must(err)
	fmt.Println(listener.Addr().(*net.TCPAddr).Port)
	conn, err := listener.Accept()
	must(err)
	_, private, err := ed25519.GenerateKey(rand.Reader)
	must(err)
	signer, err := ssh.NewSignerFromKey(private)
	must(err)
	config := &ssh.ServerConfig{PasswordCallback: func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
		if meta.User() != "iwa-test" || string(password) != "integration-secret" {
			return nil, ssh.ErrNoAuth
		}
		return nil, nil
	}}
	config.AddHostKey(signer)
	server, channels, requests, err := ssh.NewServerConn(conn, config)
	must(err)
	defer server.Close()
	go ssh.DiscardRequests(requests)
	for channelRequest := range channels {
		channel, reqs, err := channelRequest.Accept()
		if err != nil {
			continue
		}
		go func() {
			defer channel.Close()
			for req := range reqs {
				ok := req.Type == "pty-req" || req.Type == "shell"
				must(req.Reply(ok, nil))
				if req.Type == "shell" {
					_, _ = io.WriteString(channel, "ready\r\n")
					buf := make([]byte, 2048)
					for {
						n, readErr := channel.Read(buf)
						if n > 0 {
							if _, writeErr := channel.Write(buf[:n]); writeErr != nil {
								return
							}
						}
						if readErr != nil {
							return
						}
					}
				}
			}
		}()
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
