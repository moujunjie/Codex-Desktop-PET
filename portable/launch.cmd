@echo off
setlocal
set "APPDIR=%APPDATA%\CodexPixelPet"
if not exist "%APPDIR%" mkdir "%APPDIR%"

if not exist "%APPDIR%\CodexPixelPet.ps1" copy "%~dp0CodexPixelPet.ps1" "%APPDIR%\CodexPixelPet.ps1" >nul
if not exist "%APPDIR%\launch-installed.cmd" copy "%~dp0launch-installed.cmd" "%APPDIR%\launch-installed.cmd" >nul
if exist "%~dp0pixel-pet-spritesheet.png" if not exist "%APPDIR%\pixel-pet-spritesheet.png" copy "%~dp0pixel-pet-spritesheet.png" "%APPDIR%\pixel-pet-spritesheet.png" >nul
if exist "%~dp0ig_0757e341b2ac3e0e016a25782b93a4819681a6378cddac779a.png" if not exist "%APPDIR%\ig_0757e341b2ac3e0e016a25782b93a4819681a6378cddac779a.png" copy "%~dp0ig_0757e341b2ac3e0e016a25782b93a4819681a6378cddac779a.png" "%APPDIR%\ig_0757e341b2ac3e0e016a25782b93a4819681a6378cddac779a.png" >nul

call "%APPDIR%\launch-installed.cmd"
endlocal
