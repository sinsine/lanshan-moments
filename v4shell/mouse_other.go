//go:build !windows

package main

// Non-Windows builds are only used for static checks of the shell; the real
// product currently ships the Windows Wails v3 shell.
func leftButtonDown() bool {
	return false
}
