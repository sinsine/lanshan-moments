//go:build windows

package main

import "syscall"

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	getAsyncKeyState = user32.NewProc("GetAsyncKeyState")
)

// leftButtonDown reports whether the primary mouse button is currently held.
// It is used to avoid re-docking a detached window while the user is still
// dragging it across the main window.
func leftButtonDown() bool {
	state, _, _ := getAsyncKeyState.Call(0x01)
	return state&0x8000 != 0
}
