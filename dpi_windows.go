//go:build windows

package main

import "syscall"

// enableDPIAwareness is a runtime fallback for builds that do not carry the
// embedded app.manifest. Without this the whole WebView2 surface is bitmap
// stretched by Windows on 125%/150% displays, which makes every glyph blurry.
func enableDPIAwareness() {
	user32 := syscall.NewLazyDLL("user32.dll")
	setCtx := user32.NewProc("SetProcessDpiAwarenessContext")
	// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == (HANDLE)-4
	if ok, _, _ := setCtx.Call(^uintptr(3)); ok != 0 {
		return
	}
	if shcore := syscall.NewLazyDLL("shcore.dll"); shcore != nil {
		if r, _, _ := shcore.NewProc("SetProcessDpiAwareness").Call(2); r == 0 {
			return
		}
	}
	_, _, _ = user32.NewProc("SetProcessDPIAware").Call()
}
