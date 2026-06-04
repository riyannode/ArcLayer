#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ArcLayer ERC-8183 Provider Bot — One-Click Installer
#
# Usage:
#   curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash
#
# This is a thin wrapper that downloads and runs the main ERC-8183 installer
# with --role provider pre-selected. All prompts still happen interactively
# in your terminal (Agent ID, wallet, API key, private key).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALLER_URL="https://raw.githubusercontent.com/riyannode/ArcLayer/main/apps/console/public/install/erc8183-bot.sh"
TMP_SCRIPT="/tmp/arclayer-erc8183-installer-$$.sh"

cleanup() {
  rm -f "$TMP_SCRIPT"
}
trap cleanup EXIT

echo "[info] Downloading ArcLayer ERC-8183 installer..."

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$INSTALLER_URL" -o "$TMP_SCRIPT"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_SCRIPT" "$INSTALLER_URL"
else
  echo "[error] Neither curl nor wget found. Install one and retry."
  exit 1
fi

chmod +x "$TMP_SCRIPT"

echo "[ok] Installer downloaded. Starting Provider setup..."
echo ""

exec bash "$TMP_SCRIPT" --role provider
