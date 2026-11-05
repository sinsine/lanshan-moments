//go:build windows

package main

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	procReleaseCapture = user32.NewProc("ReleaseCapture")
	procPostMessageW   = user32.NewProc("PostMessageW")
)

// startNativeWindowMove enters the Windows move loop for a frameless window.
// It is used instead of relying solely on the WebView's --wails-draggable
// hit-testing, which can fail when the mouse lands on a small text child.
// The mouse capture belongs to the UI thread, so ReleaseCapture and the
// WM_NCLBUTTONDOWN message must both run there.
func startNativeWindowMove(native unsafe.Pointer) bool {
	hwnd := uintptr(native)
	if hwnd == 0 {
		return false
	}
	application.InvokeSync(func() {
		procReleaseCapture.Call()
		// WM_NCLBUTTONDOWN + HTCAPTION starts the system move gesture.
		procPostMessageW.Call(hwnd, 0x00A1, 0x0002, 0)
	})
	return true
}
