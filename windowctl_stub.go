//go:build !windows

package main

import "unsafe"

func applyCustomWindowChrome(_ unsafe.Pointer) {}

func setWindowChromeTheme(_ unsafe.Pointer, _ bool) {}

func minimizeWindow(_ unsafe.Pointer) {}

func toggleMaximizeWindow(_ unsafe.Pointer) bool { return false }

func isWindowMaximized(_ unsafe.Pointer) bool { return false }

func closeWindow(_ unsafe.Pointer) {}

func startWindowDrag(_ unsafe.Pointer) {}

func startWindowResize(_ unsafe.Pointer, _ string) {}
