@echo off
setlocal
set "PWSH=C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe"
if exist "%PWSH%" (
  "%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0CodexPixelPet.ps1"
) else (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0CodexPixelPet.ps1"
)
endlocal
