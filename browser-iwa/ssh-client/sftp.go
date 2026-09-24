package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
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

// cleanSFTPPath accepts normalized relative POSIX paths. The filesystem root is
// accepted only so callers can list it; operations reject root as a target.
func cleanSFTPPath(value string) (string, error) {
	if value == "" || len(value) > maxSFTPPathBytes || strings.ContainsAny(value, "\\\x00") || (strings.HasPrefix(value, "/") && value != "/") {
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

// rejectSymlinkParents prevents operations from traversing a symlink in any
// parent component. Final symlinks are handled according to each operation.
func rejectSymlinkParents(client *sftp.Client, cleaned string) error {
	if cleaned == "." || cleaned == "/" {
		return nil
	}
	segments := strings.Split(cleaned, "/")
	parent := "."
	for _, segment := range segments[:len(segments)-1] {
		if parent == "." {
			parent = segment
		} else {
			parent = path.Join(parent, segment)
		}
		info, err := client.Lstat(parent)
		if err != nil {
			return fmt.Errorf("inspect remote parent: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("SFTP path cannot traverse a symbolic link")
		}
		if !info.IsDir() {
			return errors.New("SFTP path parent is not a directory")
		}
	}
	return nil
}

func listSFTP(client *sftp.Client, directory string) ([]sftpEntry, error) {
	cleaned, err := cleanSFTPPath(directory)
	if err != nil {
		return nil, err
	}
	if cleaned != "/" {
		if err := rejectSymlinkParents(client, cleaned); err != nil {
			return nil, err
		}
		info, statErr := client.Lstat(cleaned)
		if statErr != nil {
			return nil, fmt.Errorf("inspect remote directory: %w", statErr)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, errors.New("only non-symlink directories can be listed")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	entries, err := client.ReadDirContextLimit(ctx, cleaned, maxSFTPEntries)
	if err != nil {
		return nil, fmt.Errorf("list remote directory: %w", err)
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
	if err := rejectSymlinkParents(client, cleaned); err != nil {
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
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("inspect opened remote file: %w", err)
	}
	currentInfo, err := client.Lstat(cleaned)
	if err != nil {
		return nil, fmt.Errorf("recheck remote file path: %w", err)
	}
	if currentInfo.Mode()&os.ModeSymlink != 0 || !currentInfo.Mode().IsRegular() ||
		openedInfo.Mode()&os.ModeSymlink != 0 || !openedInfo.Mode().IsRegular() ||
		currentInfo.Size() != info.Size() || currentInfo.ModTime() != info.ModTime() || currentInfo.Mode() != info.Mode() ||
		openedInfo.Size() != info.Size() || openedInfo.ModTime() != info.ModTime() || openedInfo.Mode() != info.Mode() {
		return nil, errors.New("remote file changed or became a symlink; refusing to download")
	}
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

func uploadSFTP(client *sftp.Client, remotePath string, data []byte) error {
	return uploadSFTPWithOverwrite(client, remotePath, data, false)
}

func uploadSFTPWithOverwrite(client *sftp.Client, remotePath string, data []byte, overwrite bool) (err error) {
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
	if err := rejectSymlinkParents(client, cleaned); err != nil {
		return err
	}
	existing, statErr := client.Lstat(cleaned)
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("check upload destination: %w", statErr)
	}
	if statErr == nil {
		if existing.Mode()&os.ModeSymlink != 0 {
			return errors.New("remote destination is a symbolic link; refusing to replace it")
		}
		if !existing.Mode().IsRegular() {
			return errors.New("remote destination is not a regular file")
		}
		if !overwrite {
			return errors.New("remote destination already exists and is a regular file; confirm replacement to overwrite")
		}
	}
	if statErr != nil {
		return createSFTPFile(client, cleaned, data)
	}

	// Stage beside the destination, then use the SFTP POSIX rename extension
	// for atomic replacement. The destination itself is never opened or followed.
	var randomName [16]byte
	if _, err := rand.Read(randomName[:]); err != nil {
		return fmt.Errorf("generate temporary upload name: %w", err)
	}
	temporaryPath := path.Join(path.Dir(cleaned), ".wrench-upload-"+hex.EncodeToString(randomName[:]))
	if len(temporaryPath) > maxSFTPPathBytes {
		return errors.New("temporary upload path exceeds the SFTP path limit")
	}
	file, err := client.OpenFile(temporaryPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return fmt.Errorf("create temporary remote file: %w", err)
	}
	renamed := false
	defer func() {
		_ = file.Close()
		if !renamed {
			_ = client.Remove(temporaryPath)
		}
	}()
	if _, err := io.Copy(file, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("write temporary remote file: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close temporary remote file: %w", err)
	}
	current, err := client.Lstat(cleaned)
	if err != nil {
		return fmt.Errorf("recheck upload destination: %w", err)
	}
	if current.Mode()&os.ModeSymlink != 0 || !current.Mode().IsRegular() {
		return errors.New("remote destination changed to a non-regular file; refusing to replace it")
	}
	if current.Size() != existing.Size() || current.ModTime() != existing.ModTime() || current.Mode() != existing.Mode() {
		return errors.New("remote destination changed during upload; refusing to replace it")
	}
	if err := client.PosixRename(temporaryPath, cleaned); err != nil {
		return fmt.Errorf("atomically replace remote file: %w", err)
	}
	renamed = true
	return nil
}

func createSFTPFile(client *sftp.Client, remotePath string, data []byte) (err error) {
	file, err := client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return fmt.Errorf("create remote file: %w", err)
	}
	written := false
	defer func() {
		_ = file.Close()
		if !written {
			_ = client.Remove(remotePath)
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
	if err := rejectSymlinkParents(client, cleaned); err != nil {
		return err
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
	if path.Dir(oldClean) != path.Dir(newClean) {
		return errors.New("renames must stay in the current remote directory")
	}
	if err := rejectSymlinkParents(client, oldClean); err != nil {
		return err
	}
	if err := rejectSymlinkParents(client, newClean); err != nil {
		return err
	}
	sourceInfo, statErr := client.Lstat(oldClean)
	if statErr != nil {
		return fmt.Errorf("inspect rename source: %w", statErr)
	}
	if sourceInfo.Mode()&os.ModeSymlink != 0 || (!sourceInfo.Mode().IsRegular() && !sourceInfo.IsDir()) {
		return errors.New("only regular files and directories can be renamed")
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
	if err := rejectSymlinkParents(client, cleaned); err != nil {
		return err
	}
	if _, statErr := client.Lstat(cleaned); statErr == nil {
		return errors.New("directory destination already exists")
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("check directory destination: %w", statErr)
	}
	if err := client.Mkdir(cleaned); err != nil {
		return fmt.Errorf("create remote directory: %w", err)
	}
	return nil
}
