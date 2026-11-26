//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var procDwmSetWindowAttribute = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")

// setDarkTitleBar asks DWM to paint the native caption in dark mode. The
// attribute id changed from 19 to 20 in Windows 10 20H1, so try both.
func setDarkTitleBar(hwnd unsafe.Pointer, dark bool) {
	if hwnd == nil {
		return
	}
	value := int32(0)
	if dark {
		value = 1
	}
	h := uintptr(hwnd)
	_, _, _ = procDwmSetWindowAttribute.Call(h, 20, uintptr(unsafe.Pointer(&value)), 4)
	_, _, _ = procDwmSetWindowAttribute.Call(h, 19, uintptr(unsafe.Pointer(&value)), 4)
}
