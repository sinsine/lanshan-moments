//go:build !windows

package main

import "unsafe"

func startNativeWindowMove(native unsafe.Pointer) bool {
	return false
}
