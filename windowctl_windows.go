//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var user32Window = syscall.NewLazyDLL("user32.dll")

var (
	procGetWindowLongPtrW = user32Window.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW = user32Window.NewProc("SetWindowLongPtrW")
	procCallWindowProcW   = user32Window.NewProc("CallWindowProcW")
	procSetWindowPos      = user32Window.NewProc("SetWindowPos")
	procShowWindow        = user32Window.NewProc("ShowWindow")
	procIsZoomed          = user32Window.NewProc("IsZoomed")
	procMonitorFromWindow = user32Window.NewProc("MonitorFromWindow")
	procGetMonitorInfoW   = user32Window.NewProc("GetMonitorInfoW")
	procReleaseCapture    = user32Window.NewProc("ReleaseCapture")
	procSendMessageW      = user32Window.NewProc("SendMessageW")
	procPostMessageW      = user32Window.NewProc("PostMessageW")
)

const (
	gwlStyle     = ^uintptr(15) // GWL_STYLE (-16)
	gwlExStyle   = ^uintptr(19) // GWL_EXSTYLE (-20)
	gwlWndProc   = ^uintptr(3)  // GWLP_WNDPROC (-4)
	wsCaption    = 0x00C00000
	wsThickFrame = 0x00040000
	wsMinimize   = 0x00020000
	wsMaximize   = 0x00010000
	wsSysMenu    = 0x00080000
	wsExAppWin   = 0x00040000

	swpNoSize     = 0x0001
	swpNoMove     = 0x0002
	swpNoZOrder   = 0x0004
	swpFrameForce = 0x0020

	swMinimize = 6
	swMaximize = 3
	swRestore  = 9

	wmClose         = 0x0010
	wmGetMinMaxInfo = 0x0024
	wmNCLButtonDown = 0x00A1
	wmNCCalcSize    = 0x0083
	htCaption       = 2

	htLeft        = 10
	htRight       = 11
	htTop         = 12
	htTopLeft     = 13
	htTopRight    = 14
	htBottom      = 15
	htBottomLeft  = 16
	htBottomRight = 17
)

// applyCustomWindowChrome removes the native caption while keeping the
// resizable thick frame. The web UI draws the entire drag region and the
// caption buttons, so the system title bar never shows through.
func applyCustomWindowChrome(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	h := uintptr(hwnd)
	style := windowLong(hwnd, gwlStyle)
	style &^= wsCaption
	style |= wsThickFrame | wsMinimize | wsMaximize | wsSysMenu
	_, _, _ = procSetWindowLongPtrW.Call(h, gwlStyle, style)

	exStyle := windowLong(hwnd, gwlExStyle)
	exStyle |= wsExAppWin
	_, _, _ = procSetWindowLongPtrW.Call(h, gwlExStyle, exStyle)

	installCustomFrameProc(hwnd)

	_, _, _ = procSetWindowPos.Call(h, 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpFrameForce)

	// Windows 11 rounds the frame; older versions simply ignore this.
	corner := int32(2)
	_, _, _ = procDwmSetWindowAttribute.Call(h, 33, uintptr(unsafe.Pointer(&corner)), 4)
	// The web title bar is the visual frame edge; suppress the DWM border.
	borderNone := uint32(0xFFFFFFFE)
	_, _, _ = procDwmSetWindowAttribute.Call(h, 34, uintptr(unsafe.Pointer(&borderNone)), 4)
}

var (
	originalFrameProc uintptr
	customFrameProc   = syscall.NewCallback(customFrameWndProc)
)

type winRect struct {
	Left, Top, Right, Bottom int32
}

type nccalcSizeParams struct {
	Rgrc [3]winRect
}

type winPoint struct {
	X, Y int32
}

type minMaxInfo struct {
	PtReserved     winPoint
	PtMaxSize      winPoint
	PtMaxPosition  winPoint
	PtMinTrackSize winPoint
	PtMaxTrackSize winPoint
}

type monitorInfo struct {
	CbSize    uint32
	RcMonitor winRect
	RcWork    winRect
	DwFlags   uint32
}

// customFrameWndProc removes the non-client sizing frame from the client
// calculation. The style still keeps WS_THICKFRAME so the window remains
// resizable and can be maximized normally; the web layer supplies its own
// edge hit areas and calls the native sizing loop. When maximized, the client
// is clipped to the monitor work area so content does not slide under the
// taskbar or lose pixels at the screen edge.
func customFrameWndProc(hwnd, msg, wp uintptr, lp unsafe.Pointer) uintptr {
	if msg == wmGetMinMaxInfo && lp != nil {
		monitor, _, _ := procMonitorFromWindow.Call(hwnd, 2) // MONITOR_DEFAULTTONEAREST
		if monitor != 0 {
			var info monitorInfo
			info.CbSize = uint32(unsafe.Sizeof(info))
			if ok, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&info))); ok != 0 {
				mi := (*minMaxInfo)(lp)
				mi.PtMaxPosition.X = info.RcWork.Left - info.RcMonitor.Left
				mi.PtMaxPosition.Y = info.RcWork.Top - info.RcMonitor.Top
				mi.PtMaxSize.X = info.RcWork.Right - info.RcWork.Left
				mi.PtMaxSize.Y = info.RcWork.Bottom - info.RcWork.Top
				return 0
			}
		}
	}
	if msg == wmNCCalcSize && wp != 0 {
		if zoomed, _, _ := procIsZoomed.Call(hwnd); zoomed != 0 {
			monitor, _, _ := procMonitorFromWindow.Call(hwnd, 2) // MONITOR_DEFAULTTONEAREST
			if monitor != 0 {
				var info monitorInfo
				info.CbSize = uint32(unsafe.Sizeof(info))
				if ok, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&info))); ok != 0 {
					if lp != nil {
						params := (*nccalcSizeParams)(lp)
						params.Rgrc[0] = info.RcWork
					}
				}
			}
		}
		return 0
	}
	if originalFrameProc != 0 {
		r, _, _ := procCallWindowProcW.Call(originalFrameProc, hwnd, msg, wp, uintptr(lp))
		return r
	}
	return 0
}

func installCustomFrameProc(hwnd unsafe.Pointer) {
	if hwnd == nil || originalFrameProc != 0 {
		return
	}
	h := uintptr(hwnd)
	originalFrameProc = windowLong(hwnd, gwlWndProc)
	_, _, _ = procSetWindowLongPtrW.Call(h, gwlWndProc, customFrameProc)
}

func windowLong(hwnd unsafe.Pointer, index uintptr) uintptr {
	value, _, _ := procGetWindowLongPtrW.Call(uintptr(hwnd), index)
	return value
}

func setWindowChromeTheme(hwnd unsafe.Pointer, dark bool) {
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

func minimizeWindow(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	_, _, _ = procShowWindow.Call(uintptr(hwnd), swMinimize)
}

func toggleMaximizeWindow(hwnd unsafe.Pointer) bool {
	if hwnd == nil {
		return false
	}
	if isWindowMaximized(hwnd) {
		_, _, _ = procShowWindow.Call(uintptr(hwnd), swRestore)
		return false
	}
	_, _, _ = procShowWindow.Call(uintptr(hwnd), swMaximize)
	return true
}

func isWindowMaximized(hwnd unsafe.Pointer) bool {
	if hwnd == nil {
		return false
	}
	value, _, _ := procIsZoomed.Call(uintptr(hwnd))
	return value != 0
}

func closeWindow(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	_, _, _ = procPostMessageW.Call(uintptr(hwnd), wmClose, 0, 0)
}

func startWindowDrag(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	_, _, _ = procReleaseCapture.Call()
	_, _, _ = procSendMessageW.Call(uintptr(hwnd), wmNCLButtonDown, htCaption, 0)
}

func startWindowResize(hwnd unsafe.Pointer, edge string) {
	if hwnd == nil {
		return
	}
	hit := uintptr(0)
	switch edge {
	case "left":
		hit = htLeft
	case "right":
		hit = htRight
	case "top":
		hit = htTop
	case "top-left":
		hit = htTopLeft
	case "top-right":
		hit = htTopRight
	case "bottom":
		hit = htBottom
	case "bottom-left":
		hit = htBottomLeft
	case "bottom-right":
		hit = htBottomRight
	}
	if hit == 0 {
		return
	}
	_, _, _ = procReleaseCapture.Call()
	_, _, _ = procSendMessageW.Call(uintptr(hwnd), wmNCLButtonDown, hit, 0)
}
