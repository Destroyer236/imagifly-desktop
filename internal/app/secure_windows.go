//go:build windows

package app

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

// Session cookies are sealed with the user's DPAPI key so the file cannot be
// lifted to another Windows account or machine.

type dataBlob struct {
	size uint32
	ptr  *byte
}

var (
	crypt32DLL  = syscall.NewLazyDLL("crypt32.dll")
	kernel32DLL = syscall.NewLazyDLL("kernel32.dll")
	procProtect = crypt32DLL.NewProc("CryptProtectData")
	procUnprot = crypt32DLL.NewProc("CryptUnprotectData")
	procFree    = kernel32DLL.NewProc("LocalFree")
)

func protect(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty session")
	}
	in := dataBlob{size: uint32(len(data)), ptr: &data[0]}
	var out dataBlob
	r, _, lastErr := procProtect.Call(
		uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&out)))
	runtime.KeepAlive(data)
	if r == 0 {
		return nil, lastErr
	}
	defer procFree.Call(uintptr(unsafe.Pointer(out.ptr)))
	buf := make([]byte, out.size)
	copy(buf, unsafe.Slice(out.ptr, int(out.size)))
	return buf, nil
}

func unprotect(blob []byte) ([]byte, error) {
	if len(blob) == 0 {
		return nil, errors.New("empty blob")
	}
	in := dataBlob{size: uint32(len(blob)), ptr: &blob[0]}
	var out dataBlob
	r, _, lastErr := procUnprot.Call(
		uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&out)))
	runtime.KeepAlive(blob)
	if r == 0 {
		return nil, lastErr
	}
	defer procFree.Call(uintptr(unsafe.Pointer(out.ptr)))
	buf := make([]byte, out.size)
	copy(buf, unsafe.Slice(out.ptr, int(out.size)))
	return buf, nil
}
