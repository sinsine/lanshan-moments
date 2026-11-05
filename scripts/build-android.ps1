# Build a debug APK. Capacitor 8 requires JDK 21 and Android SDK 36.
param(
  [string]$JdkHome = "$env:USERPROFILE\sdk\jdk21",
  [string]$AndroidHome = "$env:LOCALAPPDATA\Android\Sdk"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$JdkHome\bin\java.exe")) {
  throw "JDK 21 not found at $JdkHome. Pass -JdkHome <path>."
}
if (-not (Test-Path "$AndroidHome\platform-tools\adb.exe")) {
  throw "Android SDK not found at $AndroidHome. Pass -AndroidHome <path>."
}

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:PATH = "$JdkHome\bin;$AndroidHome\platform-tools;$AndroidHome\cmdline-tools\latest\bin;$env:PATH"

Set-Location $root
npm run build
npx cap sync android

Push-Location (Join-Path $root 'android')
try {
  .\gradlew.bat assembleDebug --no-daemon
} finally {
  Pop-Location
}

$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$name = "lanshan-moments-$version-android-universal.apk"
New-Item -ItemType Directory -Force -Path (Join-Path $root 'release') | Out-Null
Copy-Item $apk (Join-Path $root "release\$name") -Force
Write-Host "Built: $(Join-Path $root "release\$name")"
