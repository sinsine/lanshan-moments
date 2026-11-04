# Build the Windows portable app without requiring an ASCII project path.
# Requires Go 1.26+, Wails v2.17+, and WebView2 Runtime.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$wails = Get-Command wails -ErrorAction SilentlyContinue
if (-not $wails) {
  throw 'wails not found. Install it with: go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1'
}

Set-Location $root
npm run build

$stage = Join-Path $env:TEMP 'lanshan-wails-build'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item main.go, app.go, go.mod, go.sum, wails.json $stage -Force
Copy-Item build $stage -Recurse -Force
Copy-Item dist $stage -Recurse -Force

Push-Location $stage
try {
  wails build -s -skipbindings -clean -webview2 embed
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path (Join-Path $root 'release') | Out-Null
Copy-Item (Join-Path $stage 'build\bin\lanshan.exe') (Join-Path $root 'release\lanshan.exe') -Force
Write-Host "Built: $(Join-Path $root 'release\lanshan.exe')"
