@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "dist\windows-native\BurnGuard.exe" (
    echo [BurnGuard] Build the Windows app first: bun run build:windows
    echo [BurnGuard] Building requires Bun, Node and the .NET 8 SDK.
    pause
    exit /b 1
)
start "BurnGuard" "dist\windows-native\BurnGuard.exe"
