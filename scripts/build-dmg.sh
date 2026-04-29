#!/bin/bash
# Build ADB Manager with install script bundled inside the DMG
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"\(.*\)".*/\1/')
ARCH="aarch64"
DMG_NAME="ADB_Manager_${VERSION}_${ARCH}.dmg"
DMG_DIR="src-tauri/target/release/bundle/dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"
STAGING_DIR=$(mktemp -d)
APP_SRC="src-tauri/target/release/bundle/macos/ADB Manager.app"
trap 'rm -rf "$STAGING_DIR"' EXIT

echo "=== 构建 ADB Manager v${VERSION} ==="

# Step 1: Build the app bundle.
echo "[1/4] 编译应用..."
find src-tauri/target/release/bundle/macos src-tauri/target/release/bundle/dmg \
    -maxdepth 1 -name 'rw.*.dmg' -type f -delete 2>/dev/null || true
npx tauri build --bundles app

# Step 2: Verify generated build artifacts exist.
if [[ ! -d "$APP_SRC" ]]; then
    echo "错误: .app 未生成: $APP_SRC"
    exit 1
fi
if [[ ! -f "scripts/install.command" ]]; then
    echo "错误: 未找到安装脚本 scripts/install.command"
    exit 1
fi

# Step 3: Prepare staging directory
echo "[2/4] 准备 DMG 内容..."
cp -R "$APP_SRC" "$STAGING_DIR/"
cp scripts/install.command "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

# Step 4: Create DMG with custom content
echo "[3/4] 打包 DMG ..."
mkdir -p "$DMG_DIR"
rm -f "$DMG_PATH"

hdiutil create \
    -volname "ADB Manager" \
    -srcfolder "$STAGING_DIR" \
    -format UDZO \
    -ov \
    "$DMG_PATH"

echo "[4/4] 清理..."

echo ""
echo "=== DMG 打包完成 ==="
echo "输出: $DMG_PATH"
ls -lh "$DMG_PATH"
