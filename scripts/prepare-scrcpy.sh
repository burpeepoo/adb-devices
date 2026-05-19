#!/bin/bash
# Download scrcpy release binaries into src-tauri/resources/scrcpy
# Run this before building the app to bundle scrcpy for all platforms.
#
# Usage: ./scripts/prepare-scrcpy.sh [VERSION]
#   VERSION defaults to 3.2
#
# Supports: macOS Intel (x86_64), macOS Apple Silicon (aarch64), Windows (win64)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
RESOURCES_DIR="$ROOT_DIR/src-tauri/resources/scrcpy"
VERSION="${1:-3.2}"

echo "=== Preparing scrcpy v${VERSION} ==="
echo "Target directory: $RESOURCES_DIR"
echo ""

mkdir -p "$RESOURCES_DIR/macos-x86_64"
mkdir -p "$RESOURCES_DIR/macos-aarch64"
mkdir -p "$RESOURCES_DIR/windows"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

download_and_extract() {
    local url="$1"
    local dest_dir="$2"
    local label="$3"

    local ext="${url##*.}"
    local tmp_file="$TMP_DIR/$(basename "$url")"

    echo "[$label] Downloading..."
    curl -fsSL "$url" -o "$tmp_file"

    echo "[$label] Extracting..."
    rm -rf "$dest_dir"/*

    case "$ext" in
        gz|tgz)
            tar -xzf "$tmp_file" -C "$dest_dir" --strip-components=1
            ;;
        zip)
            unzip -oq "$tmp_file" -d "$dest_dir"
            # scrcpy-win64 zip has a top-level folder; flatten if needed
            local inner_dir
            inner_dir=$(find "$dest_dir" -maxdepth 1 -mindepth 1 -type d | head -n1)
            if [[ -n "$inner_dir" && -f "$inner_dir/scrcpy.exe" ]]; then
                mv "$inner_dir"/* "$dest_dir/"
                rmdir "$inner_dir"
            fi
            ;;
        *)
            echo "Unknown archive format: $ext" >&2
            exit 1
            ;;
    esac

    echo "[$label] Done."
    echo ""
}

# macOS Intel (x86_64)
download_and_extract \
    "https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/scrcpy-macos-x86_64-v${VERSION}.tar.gz" \
    "$RESOURCES_DIR/macos-x86_64" \
    "macOS Intel"

# macOS Apple Silicon (aarch64)
download_and_extract \
    "https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/scrcpy-macos-aarch64-v${VERSION}.tar.gz" \
    "$RESOURCES_DIR/macos-aarch64" \
    "macOS Apple Silicon"

# Windows (win64)
download_and_extract \
    "https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/scrcpy-win64-v${VERSION}.zip" \
    "$RESOURCES_DIR/windows" \
    "Windows"

echo "=== All platforms ready ==="
echo ""
echo "Contents:"
find "$RESOURCES_DIR" -type f | sort | while read -r f; do
    size=$(du -h "$f" | cut -f1)
    echo "  $size  ${f#$RESOURCES_DIR/}"
done
