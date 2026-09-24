package main

import (
	"bytes"
	"net"
	"testing"

	"github.com/pkg/sftp"
)

func TestCleanSFTPPathRejectsTraversalAndInvalidPaths(t *testing.T) {
	for _, value := range []string{"", "../secret", "a/../secret", "a\\secret", "//host/path", "bad\x00path"} {
		if cleaned, err := cleanSFTPPath(value); err == nil {
			t.Errorf("cleanSFTPPath(%q) = %q, want error", value, cleaned)
		}
	}
	for input, expected := range map[string]string{".": ".", "docs/guide": "docs/guide", "/home/user/": "/home/user"} {
		cleaned, err := cleanSFTPPath(input)
		if err != nil || cleaned != expected {
			t.Errorf("cleanSFTPPath(%q) = %q, %v; want %q", input, cleaned, err, expected)
		}
	}
}

func TestSFTPOperationsOverInMemoryProtocolServer(t *testing.T) {
	clientPipe, serverPipe := net.Pipe()
	server := sftp.NewRequestServer(serverPipe, sftp.InMemHandler())
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.Serve() }()
	client, err := sftp.NewClientPipe(clientPipe, clientPipe)
	if err != nil {
		t.Fatalf("create SFTP client: %v", err)
	}
	defer func() {
		_ = client.Close()
		_ = server.Close()
		<-serverDone
	}()

	if err := mkdirSFTP(client, "docs"); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := uploadSFTP(client, "docs/report.txt", []byte("private browser transfer")); err != nil {
		t.Fatalf("upload: %v", err)
	}
	if err := client.Symlink("report.txt", "docs/report-link"); err != nil {
		t.Fatalf("create fixture symlink: %v", err)
	}
	if _, err := downloadSFTP(client, "docs/report-link"); err == nil {
		t.Fatal("download followed a remote symlink")
	}
	if err := removeSFTP(client, "docs/report-link"); err != nil {
		t.Fatalf("remove fixture symlink: %v", err)
	}
	if _, err := client.Stat("docs/report.txt"); err != nil {
		t.Fatalf("removing the symlink also removed its target: %v", err)
	}
	if err := uploadSFTP(client, "docs/report.txt", []byte("overwrite")); err == nil {
		t.Fatal("upload overwrote an existing remote file")
	}
	if err := uploadSFTP(client, "docs/archive.txt", []byte("existing destination")); err != nil {
		t.Fatalf("upload rename destination: %v", err)
	}
	if err := renameSFTP(client, "docs/report.txt", "docs/archive.txt"); err == nil {
		t.Fatal("rename replaced an existing remote file")
	}
	if err := removeSFTP(client, "docs"); err == nil {
		t.Fatal("removed a non-empty directory")
	}
	if err := removeSFTP(client, "docs/archive.txt"); err != nil {
		t.Fatalf("remove occupied rename destination: %v", err)
	}
	entries, err := listSFTP(client, "docs")
	if err != nil || len(entries) != 1 || entries[0].Name != "report.txt" || entries[0].Kind != "file" {
		t.Fatalf("list entries = %#v, %v", entries, err)
	}
	data, err := downloadSFTP(client, "docs/report.txt")
	if err != nil || !bytes.Equal(data, []byte("private browser transfer")) {
		t.Fatalf("download = %q, %v", data, err)
	}
	if err := renameSFTP(client, "docs/report.txt", "docs/archive.txt"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if err := removeSFTP(client, "docs/archive.txt"); err != nil {
		t.Fatalf("remove file: %v", err)
	}
	if err := uploadSFTP(client, "docs/empty.txt", nil); err != nil {
		t.Fatalf("upload empty file: %v", err)
	}
	if data, err := downloadSFTP(client, "docs/empty.txt"); err != nil || len(data) != 0 {
		t.Fatalf("download empty file = %v, %v", data, err)
	}
	if err := removeSFTP(client, "docs/empty.txt"); err != nil {
		t.Fatalf("remove empty file: %v", err)
	}
	if err := removeSFTP(client, "docs"); err != nil {
		t.Fatalf("remove empty directory: %v", err)
	}
	if err := removeSFTP(client, "."); err == nil {
		t.Fatal("deleting the current directory succeeded")
	}
	if err := mkdirSFTP(client, "../escape"); err == nil {
		t.Fatal("mkdir traversal succeeded")
	}
	if err := uploadSFTP(client, "large", make([]byte, maxSFTPFileBytes+1)); err == nil {
		t.Fatal("oversized upload succeeded")
	}
}
