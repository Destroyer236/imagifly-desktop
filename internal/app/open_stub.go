//go:build !windows

package app

import (
	"errors"
	"net/url"
	"os/exec"
	"runtime"
)

func openExternal(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return errors.New("只允许打开 http/https 链接")
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", raw).Start()
	default:
		return exec.Command("xdg-open", raw).Start()
	}
}

func revealInExplorer(path string) error {
	dir := path
	return openExternal("file://" + dir)
}
