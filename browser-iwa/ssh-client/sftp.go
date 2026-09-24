package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

const maxSFTPFileBytes = 16 << 20
const maxSFTPEntries = 500
const maxSFTPPathBytes = 4096

type sftpEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
	Kind    string `json:"kind"`
}

// cleanSFTPPath accepts normalized relative or absolute POSIX paths and rejects traversal.
// This prevents UI/API path traversal syntax; it is not a remote filesystem sandbox because
// the account may have permissions through symlinks or absolute paths.
func cleanSFTPPath(value string) (string, error) {
	if value == "" || len(value) > maxSFTPPathBytes || strings.ContainsAny(value, "\\\x00") || strings.HasPrefix(value, "//") {
		return "", errors.New("invalid SFTP path")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return "", errors.New("parent traversal is not allowed in SFTP paths")
		}
	}
	cleaned := path.Clean(value)
	if cleaned == "" || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", errors.New("invalid SFTP path")
	}
	return cleaned, nil
}

func listSFTP(client *sftp.Client, directory string) ([]sftpEntry, error) {
	cleaned, err := cleanSFTPPath(directory)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	entries, err := client.ReadDirContext(ctx, cleaned)
	if err != nil {
		return nil, fmt.Errorf("list remote directory: %w", err)
	}
	if len(entries) > maxSFTPEntries {
		return nil, fmt.Errorf("directory contains more than %d entries", maxSFTPEntries)
	}
	result := make([]sftpEntry, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") || len(name) > 255 {
			continue
		}
		kind := "other"
		switch {
		case entry.Mode()&os.ModeSymlink != 0:
			kind = "symlink"
		case entry.IsDir():
			kind = "directory"
		case entry.Mode().IsRegular():
			kind = "file"
		}
		result = append(result, sftpEntry{Name: name, Size: entry.Size(), ModTime: entry.ModTime().Unix(), Kind: kind})
	}
	return result, nil
}

func downloadSFTP(client *sftp.Client, remotePath string) ([]byte, error) {
	cleaned, err := cleanSFTPPath(remotePath)
	if err != nil {
		return nil, err
	}
	info, err := client.Lstat(cleaned)
	if err != nil {
		return nil, fmt.Errorf("inspect remote file: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("only regular, non-symlink files can be downloaded")
	}
	if info.Size() < 0 || info.Size() > maxSFTPFileBytes {
		return nil, fmt.Errorf("remote file exceeds the %d MiB download limit", maxSFTPFileBytes>>20)
	}
	file, err := client.Open(cleaned)
	if err != nil {
		return nil, fmt.Errorf("open remote file: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSFTPFileBytes+1))
	if err != nil {
		clear(data)
		return nil, fmt.Errorf("read remote file: %w", err)
	}
	if len(data) > maxSFTPFileBytes {
		clear(data)
		return nil, fmt.Errorf("remote file exceeds the %d MiB download limit", maxSFTPFileBytes>>20)
	}
	return data, nil
}

func uploadSFTP(client *sftp.Client, remotePath string, data []byte) (err error) {
	cleaned, err := cleanSFTPPath(remotePath)
	if err != nil {
		return err
	}
	if cleaned == "." || cleaned == "/" {
		return errors.New("upload destination must be a file path")
	}
	if len(data) > maxSFTPFileBytes {
		return fmt.Errorf("uploaded files must not exceed %d MiB", maxSFTPFileBytes>>20)
	}
	if _, statErr := client.Lstat(cleaned); statErr == nil {
		return errors.New("remote destination already exists; refusing to overwrite")
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("check upload destination: %w", statErr)
	}
	file, err := client.OpenFile(cleaned, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return fmt.Errorf("create remote file: %w", err)
	}
	written := false
	defer func() {
		_ = file.Close()
		if !written {
			_ = client.Remove(cleaned)
		}
	}()
	if _, err = io.Copy(file, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("write remote file: %w", err)
	}
	if err = file.Close(); err != nil {
		return fmt.Errorf("close uploaded file: %w", err)
	}
	written = true
	return nil
}

func removeSFTP(client *sftp.Client, remotePath string) error {
	cleaned, err := cleanSFTPPath(remotePath)
	if err != nil {
		return err
	}
	if cleaned == "." || cleaned == "/" {
		return errors.New("cannot delete the current or root directory")
	}
	info, err := client.Lstat(cleaned)
	if err != nil {
		return fmt.Errorf("inspect remote path: %w", err)
	}
	if info.IsDir() {
		return client.RemoveDirectory(cleaned)
	}
	return client.Remove(cleaned)
}

func renameSFTP(client *sftp.Client, oldPath, newPath string) error {
	oldClean, err := cleanSFTPPath(oldPath)
	if err != nil {
		return err
	}
	newClean, err := cleanSFTPPath(newPath)
	if err != nil {
		return err
	}
	if oldClean == "." || oldClean == "/" || newClean == "." || newClean == "/" {
		return errors.New("cannot rename the current or root directory")
	}
	if oldClean == newClean {
		return errors.New("source and destination are identical")
	}
	if _, statErr := client.Lstat(newClean); statErr == nil {
		return errors.New("rename destination already exists; refusing to overwrite")
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("check rename destination: %w", statErr)
	}
	return client.Rename(oldClean, newClean)
}

func mkdirSFTP(client *sftp.Client, directory string) error {
	cleaned, err := cleanSFTPPath(directory)
	if err != nil {
		return err
	}
	if cleaned == "." || cleaned == "/" {
		return errors.New("directory already exists")
	}
	if err := client.Mkdir(cleaned); err != nil {
		return fmt.Errorf("create remote directory: %w", err)
	}
	return nil
}
