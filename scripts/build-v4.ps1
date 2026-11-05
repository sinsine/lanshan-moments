$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

npm run build

$stage = Join-Path $root 'v4shell\dist'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Copy-Item (Join-Path $root 'dist') $stage -Recurse

$env:PATH = "$env:USERPROFILE\sdk\go\bin;$env:USERPROFILE\go\bin;$env:PATH"
$env:GOPROXY = 'https://goproxy.cn,direct'

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$name = "lanshan-moments-$version-windows-amd64.exe"

Push-Location (Join-Path $root 'v4shell')
try {
  go build -ldflags "-H windowsgui" -o $name .
  Copy-Item $name (Join-Path $root "release\$name") -Force
  Get-Item (Join-Path $root "release\$name") | Select-Object FullName, Length, LastWriteTime
} finally {
  Pop-Location
}

