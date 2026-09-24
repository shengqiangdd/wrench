package main

import (
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestValidateTerminalDimensions(t *testing.T) {
	for _, dimensions := range []struct {
		cols int
		rows int
	}{
		{cols: 1, rows: 1},
		{cols: maxTerminalColumns, rows: maxTerminalRows},
	} {
		if err := validateTerminalDimensions(dimensions.cols, dimensions.rows); err != nil {
			t.Errorf("valid dimensions %dx%d rejected: %v", dimensions.cols, dimensions.rows, err)
		}
	}
	for _, dimensions := range []struct {
		cols int
		rows int
	}{
		{cols: 0, rows: 24},
		{cols: -1, rows: 24},
		{cols: maxTerminalColumns + 1, rows: 24},
		{cols: 80, rows: 0},
		{cols: 80, rows: -1},
		{cols: 80, rows: maxTerminalRows + 1},
	} {
		if err := validateTerminalDimensions(dimensions.cols, dimensions.rows); err == nil {
			t.Errorf("invalid dimensions %dx%d accepted", dimensions.cols, dimensions.rows)
		}
	}
}

func TestRequestTerminalResizeValidatesDimensionsBeforeSending(t *testing.T) {
	if err := requestTerminalResize(nil, maxTerminalColumns+1, 24); err == nil {
		t.Fatal("invalid dimensions accepted")
	}
	if err := requestTerminalResize((*ssh.Session)(nil), 80, 24); err == nil {
		t.Fatal("nil SSH session accepted")
	}
}
