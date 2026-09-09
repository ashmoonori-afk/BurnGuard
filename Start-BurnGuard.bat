@echo off
setlocal EnableExtensions

rem One-click launcher for BurnGuard Design (Windows).
rem Open the existing native Windows build immediately, or build it on first use.
rem After source changes, run with --rebuild to update the app before opening it.

cd /d "%~dp0"

title BurnGuard Design

if not "%~2"=="" goto usage
if "%~1"=="--build" goto build
if "%~1"=="--rebuild" goto build
if not "%~1"=="" goto usage
if exist "dist\windows-native\BurnGuard.exe" goto launch

:build
where bun >nul 2>nul
if errorlevel 1 (
    echo.
    echo [BurnGuard] Bun is not installed or not on PATH.
    echo            Install it from https://bun.sh and try again.
    echo.
    pause
    exit /b 1
)

where dotnet >nul 2>nul
if errorlevel 1 (
    echo.
    echo [BurnGuard] The .NET 8 SDK is required to build the native app.
    echo            Install it from https://dotnet.microsoft.com/download/dotnet/8.0
    echo.
    pause
    exit /b 1
)

echo [BurnGuard] Checking dependencies with bun install --frozen-lockfile...
call bun install --frozen-lockfile
if errorlevel 1 goto build_failed

echo [BurnGuard] Building the current source for the native Windows app...
echo.
call bun run build
if errorlevel 1 goto build_failed
call bun run scripts/build-windows-native.ts --skip-zip
if errorlevel 1 goto build_failed

:launch
echo [BurnGuard] Opening the native app...
start "" /D "%~dp0dist\windows-native" "%~dp0dist\windows-native\BurnGuard.exe"
if errorlevel 1 goto launch_failed
endlocal
exit /b 0

:build_failed
echo.
echo [BurnGuard] Native build failed. See the error above and try again.
echo            An older build will not be opened.
pause
exit /b 1

:launch_failed
echo.
echo [BurnGuard] The native app could not be opened. See the error above.
pause
exit /b 1

:usage
echo Usage: Start-BurnGuard.bat [--build ^| --rebuild]
echo        No option opens the existing native build; source changes need --rebuild.
exit /b 1
