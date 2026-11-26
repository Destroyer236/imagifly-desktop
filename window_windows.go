//go:build windows

package main

import "syscall"

var (
	procGetDpiForSystem  = syscall.NewLazyDLL("user32.dll").NewProc("GetDpiForSystem")
	procGetSystemMetrics = syscall.NewLazyDLL("user32.dll").NewProc("GetSystemMetrics")
)

// windowSize keeps the 1440×920 design viewport at every display scale while
// clamping the outer window to the physical screen. With per-monitor DPI
// awareness WebView2 turns the resulting client area into a crisp 1440 CSS px
// layout instead of stretching a 96-DPI bitmap.
func windowSize() (uint, uint) {
	dpi, _, _ := procGetDpiForSystem.Call()
	scale := float64(uint32(dpi))
	if scale <= 0 {
		scale = 96
	}
	scale /= 96

	width := uint(1440 * scale)
	height := uint(920 * scale)

	screenW, _, _ := procGetSystemMetrics.Call(0) // SM_CXSCREEN
	screenH, _, _ := procGetSystemMetrics.Call(1) // SM_CYSCREEN
	if maxW := uint(int(screenW) - 48); maxW > 900 && width > maxW {
		width = maxW
	}
	if maxH := uint(int(screenH) - 96); maxH > 640 && height > maxH {
		height = maxH
	}
	return width, height
}
