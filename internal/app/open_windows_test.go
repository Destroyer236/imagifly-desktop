//go:build windows

package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSystemBinaryUsesAbsoluteWindowsPaths(t *testing.T) {
	cases := [][]string{{"explorer.exe"}, {"System32", "rundll32.exe"}}
	for _, parts := range cases {
		p, err := systemBinary(parts...)
		if err != nil {
			t.Fatalf("systemBinary(%v): %v", parts, err)
		}
		if !filepath.IsAbs(p) {
			t.Fatalf("systemBinary(%v) returned non-absolute path %q", parts, p)
		}
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("systemBinary(%v) returned missing path %q: %v", parts, p, err)
		}
	}
}
