//go:build !windows

package app

// Non-Windows builds keep the session in plain text; the desktop app targets
// Windows where DPAPI is available.
func protect(data []byte) ([]byte, error)   { return data, nil }
func unprotect(data []byte) ([]byte, error) { return data, nil }
