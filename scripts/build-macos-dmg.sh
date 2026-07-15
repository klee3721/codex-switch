#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$REPO_ROOT/apps/macos"
DIST_DIR="$APP_ROOT/dist"
APP_NAME="Codex Switch.app"
APP_BUNDLE="$DIST_DIR/$APP_NAME"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
DMG_NAME="Codex-Switch-v$VERSION.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
STAGING_DIR="$APP_ROOT/.dmg-staging"

bun run build:macos:app

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

cp -R "$APP_BUNDLE" "$STAGING_DIR/$APP_NAME"
ln -s /Applications "$STAGING_DIR/Applications"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "Codex Switch $VERSION" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

hdiutil verify "$DMG_PATH" >/dev/null
rm -rf "$STAGING_DIR"

echo "$DMG_PATH"
