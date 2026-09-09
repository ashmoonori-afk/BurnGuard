#!/usr/bin/env bash
# One-click launcher for BurnGuard Design (macOS).
# Double-click this file in Finder to start the backend + frontend dev servers.
#
# Real work lives in scripts/dev-launcher.ts so the boot sequence (backend
# health check, frontend wait, browser open, clean shutdown) is identical
# on macOS and Windows.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[BurnGuard] Working directory: $SCRIPT_DIR"

if ! command -v bun >/dev/null 2>&1; then
    # Finder launches inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
    # so anything installed via Bun's official installer, Homebrew (Apple
    # Silicon or Intel), or a user-local npm prefix needs explicit fallback.
    for candidate in \
        "$HOME/.bun/bin" \
        "/opt/homebrew/bin" \
        "/usr/local/bin" \
        "$HOME/.local/bin"; do
        if [ -x "$candidate/bun" ]; then
            export PATH="$candidate:$PATH"
            break
        fi
    done
fi

if ! command -v bun >/dev/null 2>&1; then
    echo
    echo "[BurnGuard] Bun is not installed or not on PATH."
    echo "           Install it from https://bun.sh and try again."
    echo
    read -n 1 -s -r -p "Press any key to close..."
    echo
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[BurnGuard] First-time setup: running bun install --frozen-lockfile..."
    if ! bun install --frozen-lockfile; then
        echo
        echo "[BurnGuard] bun install --frozen-lockfile failed. See log above."
        echo
        read -n 1 -s -r -p "Press any key to close..."
        echo
        exit 1
    fi
fi

echo "[BurnGuard] Booting dev stack (backend then frontend)..."
echo "           Close this window to stop the servers."
echo
bun run scripts/dev-launcher.ts
status=$?

echo
echo "[BurnGuard] Dev stack stopped (exit $status)."
read -n 1 -s -r -p "Press any key to close..."
echo
exit "$status"
