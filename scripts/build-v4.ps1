$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

npm run build

$stage = Join-Path $root 'v4shell\dist'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Copy-Item (Join-Path $root 'dist') $stage -Recurse

$env:PATH = "$env:USERPROFILE\sdk\go\bin;$env:USERPROFILE\go\bin;$env:PATH"
$env:GOPROXY = 'https://goproxy.cn,direct'

Push-Location (Join-Path $root 'v4shell')
try {
  go build -o lanshan-v4.exe .
  Copy-Item lanshan-v4.exe (Join-Path $root 'release\lanshan-v4.exe') -Force
  Get-Item (Join-Path $root 'release\lanshan-v4.exe') | Select-Object FullName, Length, LastWriteTime
} finally {
  Pop-Location
}
