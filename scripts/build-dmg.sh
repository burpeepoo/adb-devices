#!/bin/bash
# Build ADB Manager DMGs with the app and Applications shortcut.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"\(.*\)".*/\1/')
DMG_DIR="src-tauri/target/release/bundle/dmg"

normalize_arch() {
    case "${1:-}" in
        "" | native)
            case "$(uname -m)" in
                arm64 | aarch64) echo "aarch64" ;;
                x86_64 | amd64) echo "x64" ;;
                *)
                    echo "Unsupported host architecture: $(uname -m)" >&2
                    exit 1
                    ;;
            esac
            ;;
        aarch64 | arm64 | apple | apple-silicon | m | m-series) echo "aarch64" ;;
        x64 | x86_64 | amd64 | intel) echo "x64" ;;
        *)
            echo "Unsupported DMG architecture: $1" >&2
            echo "Usage: $0 [native|aarch64|x64|all]" >&2
            exit 1
            ;;
    esac
}

scrcpy_path_for_arch() {
    case "$1" in
        aarch64) echo "src-tauri/resources/scrcpy/macos-aarch64/scrcpy" ;;
        x64) echo "src-tauri/resources/scrcpy/macos-x86_64/scrcpy" ;;
    esac
}

target_for_arch() {
    case "$1" in
        aarch64) echo "aarch64-apple-darwin" ;;
        x64) echo "x86_64-apple-darwin" ;;
    esac
}

build_one() {
    local arch="$1"
    local target
    local dmg_name
    local dmg_path
    local staging_dir
    local app_src

    target=$(target_for_arch "$arch")
    dmg_name="ADB_Manager_${VERSION}_${arch}.dmg"
    dmg_path="$DMG_DIR/$dmg_name"
    staging_dir=$(mktemp -d)
    app_src="src-tauri/target/${target}/release/bundle/macos/ADB Manager.app"

    cleanup() {
        rm -rf "$staging_dir"
    }
    trap cleanup RETURN

    echo "=== Building ADB Manager v${VERSION} for ${arch} (${target}) ==="

    echo "[1/3] Building app bundle..."
    find "src-tauri/target/${target}/release/bundle/macos" "$DMG_DIR" \
        -maxdepth 1 -name 'rw.*.dmg' -type f -delete 2>/dev/null || true
    npx tauri build --bundles app --target "$target"

    if [[ ! -d "$app_src" ]]; then
        echo "Error: app bundle was not generated: $app_src" >&2
        exit 1
    fi
    local scrcpy_resource
    scrcpy_resource=$(scrcpy_path_for_arch "$arch")
    if [[ ! -x "$scrcpy_resource" ]]; then
        echo "Error: missing bundled scrcpy for ${arch}: $scrcpy_resource" >&2
        echo "Run ./scripts/prepare-scrcpy.sh before building DMGs." >&2
        exit 1
    fi

    echo "[2/3] Staging DMG contents..."
    cp -R "$app_src" "$staging_dir/"
    ln -s /Applications "$staging_dir/Applications"

    echo "[3/3] Creating DMG..."
    mkdir -p "$DMG_DIR"
    rm -f "$dmg_path"
    hdiutil create \
        -volname "ADB Manager" \
        -srcfolder "$staging_dir" \
        -format UDZO \
        -ov \
        "$dmg_path"

    echo "Done"
    echo "Output: $dmg_path"
    ls -lh "$dmg_path"
}

if [[ "${1:-native}" == "all" ]]; then
    mkdir -p "$DMG_DIR"
    rm -f "$DMG_DIR"/ADB_Manager_"${VERSION}"_*.dmg
    build_one "aarch64"
    build_one "x64"
else
    build_one "$(normalize_arch "${1:-native}")"
fi
