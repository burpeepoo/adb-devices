#!/bin/bash
# ADB Manager - Install & De-quarantine Script
# Right-click this file -> Open to run (first time only)
set -euo pipefail

APP_NAME="ADB Manager.app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_APP="$SCRIPT_DIR/$APP_NAME"
TARGET_DIR="/Applications"
TARGET_APP="$TARGET_DIR/$APP_NAME"

echo "=== ADB Manager 安装器 ==="
echo ""

# Check if .app exists in the same directory as this script
if [[ ! -d "$SOURCE_APP" ]]; then
    echo "错误: 未找到 $APP_NAME"
    echo "请确保此脚本与 $APP_NAME 放在同一目录下"
    read -p "按回车键退出..."
    exit 1
fi

install_without_admin() {
    if [[ -d "$TARGET_APP" ]]; then
        echo "检测到旧版本，正在删除..."
        rm -rf "$TARGET_APP"
    fi

    echo "正在安装到 $TARGET_DIR ..."
    cp -R "$SOURCE_APP" "$TARGET_DIR/"

    echo "正在移除隔离属性..."
    xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
}

install_with_admin() {
    echo "需要管理员权限安装到 $TARGET_DIR ..."
    osascript - "$SOURCE_APP" "$TARGET_DIR" "$TARGET_APP" <<'APPLESCRIPT'
on run argv
    set sourceApp to item 1 of argv
    set targetDir to item 2 of argv
    set targetApp to item 3 of argv
    set installCommand to "set -e; /bin/rm -rf " & quoted form of targetApp & "; /bin/cp -R " & quoted form of sourceApp & " " & quoted form of targetDir & "; /usr/bin/xattr -dr com.apple.quarantine " & quoted form of targetApp & " || true"
    do shell script installCommand with administrator privileges
end run
APPLESCRIPT
}

if ! install_without_admin; then
    install_with_admin
fi

echo ""
echo "安装完成! ADB Manager 已就绪，双击即可打开。"
echo ""

# Offer to launch
read -p "是否现在启动 ADB Manager? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    open "$TARGET_APP"
fi
