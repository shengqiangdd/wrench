package main

import (
	"bytes"
	"fmt"
	"net"
	"strings"
	"testing"

	"github.com/pkg/sftp"
)

func TestCleanSFTPPathRejectsTraversalAndInvalidPaths(t *testing.T) {
	for _, value := range []string{"", "../secret", "a/../secret", "a\\secret", "//host/path", "bad\x00path", strings.Repeat("a", maxSFTPPathBytes+1)} {
		if cleaned, err := cleanSFTPPath(value); err == nil {
			t.Errorf("cleanSFTPPath(%q) = %q, want error", value, cleaned)
		}
	}
	for _, value := range []string{"/home/user", "/home/user/secret"} {
		if cleaned, err := cleanSFTPPath(value); err == nil {
			t.Errorf("cleanSFTPPath(%q) = %q, want absolute path rejection", value, cleaned)
		}
	}
	for input, expected := range map[string]string{".": ".", "docs/guide": "docs/guide", "/": "/"} {
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
	if err := mkdirSFTP(client, "outside-dir"); err != nil {
		t.Fatalf("create outside sentinel directory: %v", err)
	}
	outsideSentinel, err := client.Create("outside-dir/report.txt")
	if err != nil {
		t.Fatalf("create outside sentinel: %v", err)
	}
	if _, err := outsideSentinel.Write([]byte("outside directory sentinel")); err != nil {
		t.Fatalf("write outside sentinel: %v", err)
	}
	if err := outsideSentinel.Close(); err != nil {
		t.Fatalf("close outside sentinel: %v", err)
	}
	if err := client.Symlink("../outside-dir/report.txt", "docs/report-link"); err != nil {
		t.Fatalf("create fixture symlink: %v", err)
	}
	if err := client.Symlink("outside-dir", "docs-link"); err != nil {
		t.Fatalf("create parent fixture symlink: %v", err)
	}
	if _, err := downloadSFTP(client, "docs/report-link"); err == nil {
		t.Fatal("download followed a remote symlink")
	}
	if err := uploadSFTP(client, "docs/report-link", []byte("replace target")); err == nil {
		t.Fatal("upload replaced a symlink or followed its target")
	}
	if err := uploadSFTPWithOverwrite(client, "docs/report-link", []byte("replace target"), true); err == nil {
		t.Fatal("confirmed upload replaced a symlink or followed its target")
	}
	if err := uploadSFTPWithOverwrite(client, "docs", []byte("replace directory"), true); err == nil {
		t.Fatal("confirmed upload replaced a directory")
	}
	if err := mkdirSFTP(client, "docs/report-link"); err == nil {
		t.Fatal("mkdir followed or replaced a final symlink")
	}
	if err := renameSFTP(client, "docs/report-link", "docs/renamed-link"); err == nil {
		t.Fatal("rename followed or moved a final symlink")
	}
	if err := renameSFTP(client, "docs/report.txt", "docs-link/report.txt"); err == nil {
		t.Fatal("rename traversed a symlink destination parent")
	}
	if err := renameSFTP(client, "docs/report.txt", "docs/report-link"); err == nil {
		t.Fatal("rename replaced a final symlink")
	}
	if err := renameSFTP(client, "docs/report.txt", "archive/report.txt"); err == nil {
		t.Fatal("cross-directory rename succeeded")
	}
	if _, err := listSFTP(client, "docs-link"); err == nil {
		t.Fatal("listing followed a parent symlink")
	}
	if _, err := listSFTP(client, "docs/report-link"); err == nil {
		t.Fatal("listing followed a final symlink")
	}
	if _, err := downloadSFTP(client, "docs-link/report.txt"); err == nil {
		t.Fatal("download traversed a parent symlink")
	}
	if err := uploadSFTP(client, "docs-link/escaped.txt", []byte("escape")); err == nil {
		t.Fatal("upload traversed a parent symlink")
	}
	if err := removeSFTP(client, "docs-link/report.txt"); err == nil {
		t.Fatal("remove traversed a parent symlink")
	}
	if err := mkdirSFTP(client, "docs-link/escaped-dir"); err == nil {
		t.Fatal("mkdir traversed a parent symlink")
	}
	if err := renameSFTP(client, "docs/report.txt", "docs-link/escaped.txt"); err == nil {
		t.Fatal("rename traversed a destination parent symlink")
	}
	if err := renameSFTP(client, "docs-link/report.txt", "docs/escaped.txt"); err == nil {
		t.Fatal("rename traversed a source parent symlink")
	}
	if err := removeSFTP(client, "docs/report-link"); err != nil {
		t.Fatalf("remove fixture symlink: %v", err)
	}
	targetSentinel, err := downloadSFTP(client, "docs/report.txt")
	if err != nil || !bytes.Equal(targetSentinel, []byte("private browser transfer")) {
		t.Fatalf("symlink operations changed/followed the selected-directory target: %q, %v", targetSentinel, err)
	}
	outsideAfter, err := downloadSFTP(client, "outside-dir/report.txt")
	if err != nil || !bytes.Equal(outsideAfter, []byte("outside directory sentinel")) {
		t.Fatalf("symlink operations changed/followed the outside-directory sentinel: %q, %v", outsideAfter, err)
	}
	if err := uploadSFTPWithOverwrite(client, "docs/report.txt", []byte("confirmed replacement"), true); err != nil {
		t.Fatalf("confirmed atomic replacement: %v", err)
	}
	replaced, err := downloadSFTP(client, "docs/report.txt")
	if err != nil || !bytes.Equal(replaced, []byte("confirmed replacement")) {
		t.Fatalf("confirmed replacement contents = %q, %v", replaced, err)
	}
	if err := uploadSFTP(client, "docs/report.txt", []byte("overwrite")); err == nil {
		t.Fatal("upload overwrote an existing remote file without confirmation")
	}
	unchanged, err := downloadSFTP(client, "docs/report.txt")
	if err != nil || !bytes.Equal(unchanged, []byte("confirmed replacement")) {
		t.Fatalf("refused overwrite changed the existing file: %q, %v", unchanged, err)
	}
	if _, err := listSFTP(client, "/"); err != nil {
		t.Fatalf("listing filesystem root: %v", err)
	}
	if _, err := listSFTP(client, "/docs"); err == nil {
		t.Fatal("listing an absolute non-root path succeeded")
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
	if err != nil || !bytes.Equal(data, []byte("confirmed replacement")) {
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
	large, err := client.Create("large-download")
	if err != nil {
		t.Fatalf("create oversized download fixture: %v", err)
	}
	if _, err := large.Write(make([]byte, maxSFTPFileBytes+1)); err != nil {
		t.Fatalf("write oversized download fixture: %v", err)
	}
	if err := large.Close(); err != nil {
		t.Fatalf("close oversized download fixture: %v", err)
	}
	if _, err := downloadSFTP(client, "large-download"); err == nil {
		t.Fatal("oversized download succeeded")
	}
	if err := client.Remove("large-download"); err != nil {
		t.Fatalf("remove oversized download fixture: %v", err)
	}
	for i := 0; i <= maxSFTPEntries; i++ {
		file, err := client.Create(fmt.Sprintf("entry-%03d", i))
		if err != nil {
			t.Fatalf("create listing fixture %d: %v", i, err)
		}
		if err := file.Close(); err != nil {
			t.Fatalf("close listing fixture %d: %v", i, err)
		}
	}
	if _, err := listSFTP(client, "/"); err == nil {
		t.Fatal("listing with more than the entry limit succeeded")
	}
}
