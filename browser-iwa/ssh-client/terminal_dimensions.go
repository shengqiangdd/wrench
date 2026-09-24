package main

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/ssh"
)

const (
	minTerminalColumns = 1
	maxTerminalColumns = 500
	minTerminalRows    = 1
	maxTerminalRows    = 300
)

func validateTerminalDimensions(cols, rows int) error {
	if cols < minTerminalColumns || cols > maxTerminalColumns {
		return fmt.Errorf("terminal columns must be between %d and %d", minTerminalColumns, maxTerminalColumns)
	}
	if rows < minTerminalRows || rows > maxTerminalRows {
		return fmt.Errorf("terminal rows must be between %d and %d", minTerminalRows, maxTerminalRows)
	}
	return nil
}

func requestTerminalResize(session *ssh.Session, cols, rows int) error {
	if err := validateTerminalDimensions(cols, rows); err != nil {
		return err
	}
	if session == nil {
		return errors.New("no active SSH shell")
	}
	return session.WindowChange(rows, cols)
}
