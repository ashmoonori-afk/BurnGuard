@echo off
setlocal EnableExtensions

rem One-click launcher for BurnGuard Design (Windows).
rem Double-click this file to start the backend + frontend dev servers.
rem
rem Real work lives in scripts\dev-launcher.ts so the boot sequence (backend
rem health check, frontend wait, browser open, clean shutdown) is identical
rem on Windows and macOS.

cd /d "%~dp0"

title BurnGuard Design

where bun >nul 2>nul
if errorlevel 1 (
    echo.
    echo [BurnGuard] Bun is not installed or not on PATH.
    echo            Install it from https://bun.sh and try again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [BurnGuard] First-time setup: running bun install --frozen-lockfile...
    call bun install --frozen-lockfile
    if errorlevel 1 (
        echo.
        echo [BurnGuard] bun install --frozen-lockfile failed. See log above.
        echo.
        pause
        exit /b 1
    )
)

echo [BurnGuard] Booting dev stack (backend then frontend)...
echo            Close this window to stop the servers.
echo.
call bun run scripts/dev-launcher.ts

echo.
echo [BurnGuard] Dev stack stopped.
pause
endlocal
