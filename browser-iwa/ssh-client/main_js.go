//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"syscall/js"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

var activeMu sync.Mutex
var active *sshSession
var promiseCtor = js.Global().Get("Promise")

type sshSession struct {
	client  *ssh.Client
	shell   *ssh.Session
	stdin   io.WriteCloser
	onData  js.Value
	sftpMu  sync.Mutex
	sftp    *sftp.Client
	sftpErr error
}

type jsConn struct {
	socket  js.Value
	reader  js.Value
	writer  js.Value
	readMu  sync.Mutex
	pending []byte
	writeMu sync.Mutex
	close   sync.Once
}

func await(promise js.Value) (js.Value, error) {
	result := make(chan struct {
		v   js.Value
		err error
	}, 1)
	then := js.FuncOf(func(this js.Value, args []js.Value) any {
		result <- struct {
			v   js.Value
			err error
		}{v: args[0]}
		return nil
	})
	catch := js.FuncOf(func(this js.Value, args []js.Value) any {
		result <- struct {
			v   js.Value
			err error
		}{err: jsError(args[0])}
		return nil
	})
	promise.Call("then", then).Call("catch", catch)
	r := <-result
	then.Release()
	catch.Release()
	return r.v, r.err
}

func jsError(value js.Value) error {
	if value.Type() == js.TypeObject && !value.IsNull() {
		message := value.Get("message")
		if message.Type() == js.TypeString && message.String() != "" {
			return errors.New(message.String())
		}
	}
	return errors.New(value.String())
}

func copyJSBytes(value js.Value, label string, maxBytes int) ([]byte, error) {
	if value.Type() == js.TypeUndefined || value.Type() == js.TypeNull {
		return nil, nil
	}
	if value.Type() != js.TypeObject || !value.InstanceOf(js.Global().Get("Uint8Array")) {
		return nil, fmt.Errorf("%s must be a Uint8Array", label)
	}
	length := value.Get("byteLength").Int()
	if length > maxBytes {
		return nil, fmt.Errorf("%s exceeds the %d-byte limit", label, maxBytes)
	}
	result := make([]byte, length)
	if copied := js.CopyBytesToGo(result, value); copied != len(result) {
		clear(result)
		return nil, fmt.Errorf("could not read %s bytes", label)
	}
	return result, nil
}

func zeroJSBytes(value js.Value) {
	defer func() { _ = recover() }()
	if value.Type() == js.TypeObject && !value.IsNull() && value.Get("fill").Type() == js.TypeFunction {
		value.Call("fill", 0)
	}
}

func promise(run func() error) js.Value {
	return valuePromise(func() (js.Value, error) {
		return js.Undefined(), run()
	})
}

func valuePromise(run func() (js.Value, error)) js.Value {
	executor := js.FuncOf(func(this js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			value, err := run()
			if err != nil {
				reject.Invoke(err.Error())
				return
			}
			resolve.Invoke(value)
		}()
		return nil
	})
	p := promiseCtor.New(executor)
	executor.Release()
	return p
}

func (c *jsConn) Read(p []byte) (int, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	if len(p) == 0 {
		return 0, nil
	}
	for len(c.pending) == 0 {
		v, err := await(c.reader.Call("read"))
		if err != nil {
			return 0, err
		}
		if v.Get("done").Bool() {
			return 0, io.EOF
		}
		chunk := v.Get("value")
		c.pending = make([]byte, chunk.Get("byteLength").Int())
		js.CopyBytesToGo(c.pending, chunk)
	}
	n := copy(p, c.pending)
	c.pending = c.pending[n:]
	return n, nil
}
func (c *jsConn) Write(p []byte) (int, error) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	b := js.Global().Get("Uint8Array").New(len(p))
	js.CopyBytesToJS(b, p)
	if _, err := await(c.writer.Call("write", b)); err != nil {
		return 0, err
	}
	return len(p), nil
}
func (c *jsConn) Close() error {
	var closeErr error
	c.close.Do(func() {
		// Direct Sockets rejects TCPSocket.close() while either stream is locked.
		// Cancel the pending read first so the SSH read goroutine can release its lock.
		if _, err := await(c.reader.Call("cancel")); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("cancel TCP reader: %w", err))
		}
		c.readMu.Lock()
		c.reader.Call("releaseLock")
		c.readMu.Unlock()

		// Finish queued SSH writes, then release the writer lock before closing the socket.
		c.writeMu.Lock()
		if _, err := await(c.writer.Call("close")); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("close TCP writer: %w", err))
		}
		c.writer.Call("releaseLock")
		c.writeMu.Unlock()

		if err := awaitIfPromise(c.socket.Call("close")); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("close TCP socket: %w", err))
		}
	})
	return closeErr
}
func (c *jsConn) LocalAddr() net.Addr              { return dummyAddr("browser-local") }
func (c *jsConn) RemoteAddr() net.Addr             { return dummyAddr("direct-socket") }
func (c *jsConn) SetDeadline(time.Time) error      { return nil }
func (c *jsConn) SetReadDeadline(time.Time) error  { return nil }
func (c *jsConn) SetWriteDeadline(time.Time) error { return nil }

type dummyAddr string

func (a dummyAddr) Network() string { return "tcp" }
func (a dummyAddr) String() string  { return string(a) }

func connect(args []js.Value) any {
	if len(args) == 0 {
		return promise(func() error { return errors.New("missing connection options") })
	}
	opts := args[0]
	return promise(func() error {
		host, user := opts.Get("host").String(), opts.Get("username").String()
		port := opts.Get("port").Int()
		if !allowedTarget(host, port) {
			return errors.New("target must be a private IP literal on TCP port 22")
		}
		if user == "" || len(user) > 128 {
			return errors.New("valid SSH username required")
		}
		confirm := opts.Get("confirmHostKey")
		output := opts.Get("onData")
		if confirm.Type() != js.TypeFunction || output.Type() != js.TypeFunction {
			return errors.New("host-key confirmation and terminal output callbacks required")
		}
		socketCtor := js.Global().Get("TCPSocket")
		if socketCtor.Type() != js.TypeFunction {
			return errors.New("Direct Sockets unavailable; use the installed Chrome IWA")
		}
		sock := opts.Get("socket")
		if sock.Type() == js.TypeUndefined || sock.Type() == js.TypeNull {
			sock = socketCtor.New(host, port, map[string]any{"keepAlive": false, "noDelay": true})
		}
		if sock.Type() != js.TypeObject || sock.Get("opened").Type() != js.TypeObject {
			return errors.New("a valid browser TCP socket is required")
		}
		openedResult := make(chan struct {
			value js.Value
			err   error
		}, 1)
		go func() {
			value, err := await(sock.Get("opened"))
			openedResult <- struct {
				value js.Value
				err   error
			}{value, err}
		}()
		var opened js.Value
		var err error
		select {
		case result := <-openedResult:
			opened, err = result.value, result.err
		case <-time.After(12 * time.Second):
			_ = awaitClose(sock)
			return errors.New("TCP connect timed out")
		}
		if err != nil {
			_ = awaitClose(sock)
			return fmt.Errorf("TCP connect: %w", err)
		}
		conn := &jsConn{socket: sock, reader: opened.Get("readable").Call("getReader"), writer: opened.Get("writable").Call("getWriter")}
		password := ""
		if passwordValue := opts.Get("password"); passwordValue.Type() == js.TypeString {
			password = passwordValue.String()
		}
		privateKeyJS := opts.Get("privateKey")
		defer zeroJSBytes(privateKeyJS)
		privateKey, err := copyJSBytes(privateKeyJS, "SSH private key", 64*1024)
		if err != nil {
			_ = conn.Close()
			return err
		}
		defer clear(privateKey)
		zeroJSBytes(privateKeyJS)
		passphraseJS := opts.Get("privateKeyPassphrase")
		defer zeroJSBytes(passphraseJS)
		passphrase, err := copyJSBytes(passphraseJS, "SSH private-key passphrase", 4096)
		if err != nil {
			_ = conn.Close()
			return err
		}
		defer clear(passphrase)
		zeroJSBytes(passphraseJS)
		if len(privateKey) > 0 && password != "" {
			_ = conn.Close()
			return errors.New("choose either password or private-key authentication")
		}
		if len(privateKey) == 0 && len(passphrase) > 0 {
			_ = conn.Close()
			return errors.New("private-key passphrase provided without a private key")
		}
		confirmHost := func(keyType, fingerprint string) bool {
			approved, confirmErr := await(confirm.Invoke(host, keyType, fingerprint))
			return confirmErr == nil && approved.Bool()
		}
		// Authenticate only after host-key approval; private-key inputs are zeroed after the handshake.
		handshakeTimer := time.AfterFunc(20*time.Second, func() { _ = conn.Close() })
		var client *ssh.Client
		if len(privateKey) > 0 {
			client, err = newSSHClientWithPrivateKey(conn, net.JoinHostPort(host, strconv.Itoa(port)), user, privateKey, passphrase, confirmHost)
		} else {
			client, err = newSSHClient(conn, net.JoinHostPort(host, strconv.Itoa(port)), user, password, confirmHost)
		}
		handshakeTimer.Stop()
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("SSH connection/authentication failed: %w", err)
		}
		shell, err := client.NewSession()
		if err != nil {
			_ = client.Close()
			return err
		}
		stdin, err := shell.StdinPipe()
		if err != nil {
			_ = shell.Close()
			_ = client.Close()
			return err
		}
		stdout, err := shell.StdoutPipe()
		if err != nil {
			_ = shell.Close()
			_ = client.Close()
			return err
		}
		stderr, err := shell.StderrPipe()
		if err != nil {
			_ = shell.Close()
			_ = client.Close()
			return err
		}
		if err := shell.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}); err != nil {
			_ = shell.Close()
			_ = client.Close()
			return err
		}
		if err := shell.Shell(); err != nil {
			_ = shell.Close()
			_ = client.Close()
			return err
		}
		s := &sshSession{client: client, shell: shell, stdin: stdin, onData: output}
		activeMu.Lock()
		if active != nil {
			activeMu.Unlock()
			_ = s.close()
			return errors.New("an SSH session is already active")
		}
		active = s
		activeMu.Unlock()
		go s.forward(stdout)
		go s.forward(stderr)
		return nil
	})
}

func (s *sshSession) forward(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			copyBuf := append([]byte(nil), buf[:n]...)
			b := js.Global().Get("Uint8Array").New(len(copyBuf))
			js.CopyBytesToJS(b, copyBuf)
			s.onData.Invoke(b)
		}
		if err != nil {
			return
		}
	}
}
func (s *sshSession) close() error {
	// Close the underlying transport first so a stalled SFTP request is interrupted
	// before waiting for the operation lock.
	closeErr := s.client.Close()
	s.sftpMu.Lock()
	if s.sftp != nil {
		_ = s.sftp.Close()
		s.sftp = nil
	}
	s.sftpMu.Unlock()
	_ = s.shell.Close()
	return closeErr
}
func awaitIfPromise(value js.Value) error {
	if value.Type() != js.TypeObject && value.Type() != js.TypeFunction {
		return nil
	}
	then := value.Get("then")
	if then.Type() != js.TypeFunction {
		return nil
	}
	_, err := await(value)
	return err
}

func awaitClose(sock js.Value) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("close uninitialized TCP socket: %v", recovered)
		}
	}()
	return awaitIfPromise(sock.Call("close"))
}
func currentSession() (*sshSession, error) {
	activeMu.Lock()
	defer activeMu.Unlock()
	if active == nil {
		return nil, errors.New("no active SSH session")
	}
	return active, nil
}

func stringArg(args []js.Value, index int, label string) (string, error) {
	if len(args) <= index || args[index].Type() != js.TypeString {
		return "", fmt.Errorf("%s must be a string", label)
	}
	return args[index].String(), nil
}

func (s *sshSession) withSFTP(operation func(*sftp.Client) error) error {
	s.sftpMu.Lock()
	defer s.sftpMu.Unlock()
	if s.sftp == nil && s.sftpErr == nil {
		s.sftp, s.sftpErr = sftp.NewClient(s.client)
	}
	if s.sftpErr != nil {
		return fmt.Errorf("SFTP subsystem unavailable: %w", s.sftpErr)
	}
	return operation(s.sftp)
}

func sftpList(args []js.Value) any {
	return valuePromise(func() (js.Value, error) {
		directory, err := stringArg(args, 0, "remote directory")
		if err != nil {
			return js.Undefined(), err
		}
		session, err := currentSession()
		if err != nil {
			return js.Undefined(), err
		}
		var entries []sftpEntry
		err = session.withSFTP(func(client *sftp.Client) error {
			var listErr error
			entries, listErr = listSFTP(client, directory)
			return listErr
		})
		if err != nil {
			return js.Undefined(), err
		}
		encoded, err := json.Marshal(entries)
		if err != nil {
			return js.Undefined(), err
		}
		return js.Global().Get("JSON").Call("parse", string(encoded)), nil
	})
}

func sftpDownload(args []js.Value) any {
	return valuePromise(func() (js.Value, error) {
		remotePath, err := stringArg(args, 0, "remote file path")
		if err != nil {
			return js.Undefined(), err
		}
		session, err := currentSession()
		if err != nil {
			return js.Undefined(), err
		}
		var data []byte
		err = session.withSFTP(func(client *sftp.Client) error {
			var readErr error
			data, readErr = downloadSFTP(client, remotePath)
			return readErr
		})
		if err != nil {
			clear(data)
			return js.Undefined(), err
		}
		result := js.Global().Get("Uint8Array").New(len(data))
		js.CopyBytesToJS(result, data)
		clear(data)
		return result, nil
	})
}

func sftpUpload(args []js.Value) any {
	return promise(func() error {
		remotePath, err := stringArg(args, 0, "remote file path")
		if err != nil {
			return err
		}
		if len(args) <= 1 {
			return errors.New("upload data is required")
		}
		dataJS := args[1]
		defer zeroJSBytes(dataJS)
		data, err := copyJSBytes(dataJS, "upload data", maxSFTPFileBytes)
		if err != nil {
			return err
		}
		defer clear(data)
		session, err := currentSession()
		if err != nil {
			return err
		}
		return session.withSFTP(func(client *sftp.Client) error { return uploadSFTP(client, remotePath, data) })
	})
}

func sftpRemove(args []js.Value) any {
	return promise(func() error {
		remotePath, err := stringArg(args, 0, "remote path")
		if err != nil {
			return err
		}
		session, err := currentSession()
		if err != nil {
			return err
		}
		return session.withSFTP(func(client *sftp.Client) error { return removeSFTP(client, remotePath) })
	})
}

func sftpRename(args []js.Value) any {
	return promise(func() error {
		oldPath, err := stringArg(args, 0, "source path")
		if err != nil {
			return err
		}
		newPath, err := stringArg(args, 1, "destination path")
		if err != nil {
			return err
		}
		session, err := currentSession()
		if err != nil {
			return err
		}
		return session.withSFTP(func(client *sftp.Client) error { return renameSFTP(client, oldPath, newPath) })
	})
}

func sftpMkdir(args []js.Value) any {
	return promise(func() error {
		remotePath, err := stringArg(args, 0, "remote directory path")
		if err != nil {
			return err
		}
		session, err := currentSession()
		if err != nil {
			return err
		}
		return session.withSFTP(func(client *sftp.Client) error { return mkdirSFTP(client, remotePath) })
	})
}

func send(args []js.Value) any {
	return promise(func() error {
		activeMu.Lock()
		s := active
		activeMu.Unlock()
		if s == nil {
			return errors.New("no active SSH shell")
		}
		if len(args) == 0 || args[0].Type() != js.TypeString {
			return errors.New("terminal input must be text")
		}
		_, err := io.WriteString(s.stdin, args[0].String())
		return err
	})
}
func closeSession(_ []js.Value) any {
	return promise(func() error {
		activeMu.Lock()
		s := active
		active = nil
		activeMu.Unlock()
		if s == nil {
			return nil
		}
		return s.close()
	})
}
func main() {
	api := js.Global().Get("Object").New()
	api.Set("connect", js.FuncOf(func(_ js.Value, args []js.Value) any { return connect(args) }))
	api.Set("send", js.FuncOf(func(_ js.Value, args []js.Value) any { return send(args) }))
	api.Set("listDirectory", js.FuncOf(func(_ js.Value, args []js.Value) any { return sftpList(args) }))
	api.Set("downloadFile", js.FuncOf(func(_ js.Value, args []js.Value) any { return sftpDownload(args) }))
	api.Set("uploadFile", js.FuncOf(func(_ js.Value, args []js.Value) any { return sftpUpload(args) }))
	api.Set("removePath", js.FuncOf(func(_ js.Value, args []js.Value) any { return sftpRemove(args) }))
	api.Set("renamePath", js.FuncOf(func(_ js.Value, args []js.Value) any { return sftpRename(args) }))
	api.Set("makeDirectory", js.FuncOf(func(_ js.Value, args []js.Value) any { return sftpMkdir(args) }))
	api.Set("close", js.FuncOf(func(_ js.Value, args []js.Value) any { return closeSession(args) }))
	js.Global().Set("wrenchIwaSsh", api)
	select {}
}
