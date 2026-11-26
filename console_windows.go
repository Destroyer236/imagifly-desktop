//go:build windows

package main

import "syscall"

var procFreeConsole = syscall.NewLazyDLL("kernel32.dll").NewProc("FreeConsole")

// hideConsole detaches the process from the console that Windows created for
// this console-subsystem binary, so double-clicking the exe does not leave a
// black terminal window behind the app.
func hideConsole() {
	_, _, _ = procFreeConsole.Call()
}
