//go:build !windows

package main

import "unsafe"

func setDarkTitleBar(_ unsafe.Pointer, _ bool) {}
