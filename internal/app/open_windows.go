//go:build windows

package app

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func openExternal(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return errors.New("链接为空")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return errors.New("只允许打开 http/https 链接")
	}
	rundll32, err := systemBinary("System32", "rundll32.exe")
	if err != nil {
		return err
	}
	return exec.Command(rundll32, "url.dll,FileProtocolHandler", raw).Start()
}

func revealInExplorer(path string) error {
	explorer, err := systemBinary("explorer.exe")
	if err != nil {
		return err
	}
	return exec.Command(explorer, "/select,"+path).Start()
}

// The desktop app is started by a launcher with a reduced PATH (it does not
// necessarily include C:\Windows), so never rely on PATH for built-in
// executables such as explorer.exe / rundll32.exe.
func systemBinary(parts ...string) (string, error) {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = os.Getenv("windir")
	}
	if root == "" {
		root = `C:\Windows`
	}
	path := filepath.Join(append([]string{root}, parts...)...)
	if st, err := os.Stat(path); err == nil && !st.IsDir() {
		return path, nil
	}
	return "", fmt.Errorf("找不到系统程序：%s", path)
}
