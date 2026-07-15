#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$REPO_ROOT/apps/macos"
BUILD_ROOT="$APP_ROOT/.build"
DIST_DIR="$APP_ROOT/dist"
APP_NAME="Codex Switch.app"
APP_BUNDLE="$DIST_DIR/$APP_NAME"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
BRIDGE_DIR="$RESOURCES_DIR/bridge"
INFO_PLIST_SRC="$APP_ROOT/Info.plist"
ICON_SVG_SRC="$APP_ROOT/Sources/CodexSwitchMac/Resources/app-icon.svg"
LOGO_SVG_SRC="$APP_ROOT/Sources/CodexSwitchMac/Resources/app-logo.svg"
ICON_WORK_DIR="$APP_ROOT/.icon-build"
ICONSET_DIR="$ICON_WORK_DIR/AppIcon.iconset"
ICON_PREVIEW="$ICON_WORK_DIR/app-icon.svg.png"
LOGO_PREVIEW="$ICON_WORK_DIR/app-logo.svg.png"

mkdir -p "$DIST_DIR"

if pgrep -x CodexSwitchMac >/dev/null 2>&1; then
  echo "Stopping running Codex Switch app before replacing the bundle..."
  pkill -TERM -x CodexSwitchMac >/dev/null 2>&1 || true
  sleep 0.6
  if pgrep -x CodexSwitchMac >/dev/null 2>&1; then
    pkill -KILL -x CodexSwitchMac >/dev/null 2>&1 || true
  fi
fi

echo "Building TypeScript bridge..."
bun run build

echo "Building release executable..."
swift build --package-path "$APP_ROOT" -c release

EXECUTABLE_PATH="$(find "$BUILD_ROOT" -type f -path '*/release/CodexSwitchMac' | head -n 1)"
if [[ -z "${EXECUTABLE_PATH:-}" ]]; then
  echo "Failed to locate release executable." >&2
  exit 1
fi

rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$BRIDGE_DIR" "$BRIDGE_DIR/core"

cp "$EXECUTABLE_PATH" "$MACOS_DIR/CodexSwitchMac"
chmod +x "$MACOS_DIR/CodexSwitchMac"
cp "$INFO_PLIST_SRC" "$CONTENTS_DIR/Info.plist"

cp "$REPO_ROOT/dist/bridge-cli.js" "$BRIDGE_DIR/bridge-cli.js"
cp "$REPO_ROOT/dist/bridge.js" "$BRIDGE_DIR/bridge.js"
cp -R "$REPO_ROOT/dist/core/." "$BRIDGE_DIR/core/"
chmod +x "$BRIDGE_DIR/bridge-cli.js"
cat > "$BRIDGE_DIR/package.json" <<'JSON'
{
  "type": "module"
}
JSON

rm -rf "$ICON_WORK_DIR"
mkdir -p "$ICONSET_DIR"
qlmanage -t -s 1024 -o "$ICON_WORK_DIR" "$ICON_SVG_SRC" >/dev/null 2>&1
qlmanage -t -s 1024 -o "$ICON_WORK_DIR" "$LOGO_SVG_SRC" >/dev/null 2>&1

if [[ ! -f "$ICON_PREVIEW" ]]; then
  echo "Failed to render SVG app icon." >&2
  exit 1
fi
if [[ ! -f "$LOGO_PREVIEW" ]]; then
  echo "Failed to render SVG app logo." >&2
  exit 1
fi

cp "$ICON_SVG_SRC" "$RESOURCES_DIR/app-icon.svg"
cp "$LOGO_SVG_SRC" "$RESOURCES_DIR/app-logo.svg"
cp "$ICON_PREVIEW" "$RESOURCES_DIR/app-icon.png"
cp "$LOGO_PREVIEW" "$RESOURCES_DIR/app-logo.png"
cp "$ICON_PREVIEW" "$RESOURCES_DIR/AppGlyph.png"

sips -z 16 16 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_PREVIEW" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
cp "$ICON_PREVIEW" "$ICONSET_DIR/icon_512x512@2x.png"
iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns"

for required_file in \
  "$MACOS_DIR/CodexSwitchMac" \
  "$CONTENTS_DIR/Info.plist" \
  "$BRIDGE_DIR/bridge-cli.js" \
  "$BRIDGE_DIR/bridge.js" \
  "$BRIDGE_DIR/package.json" \
  "$RESOURCES_DIR/app-icon.png" \
  "$RESOURCES_DIR/app-logo.png" \
  "$RESOURCES_DIR/AppGlyph.png" \
  "$RESOURCES_DIR/AppIcon.icns"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Build artifact missing: $required_file" >&2
    exit 1
  fi
done

if [[ ! -x "$BRIDGE_DIR/bridge-cli.js" ]]; then
  echo "Bundled bridge is not executable: $BRIDGE_DIR/bridge-cli.js" >&2
  exit 1
fi

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true
fi

echo "Built app bundle:"
echo "$APP_BUNDLE"
