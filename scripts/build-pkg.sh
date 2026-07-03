#!/bin/bash
# Build signed macOS PKG installers from the generated app bundles.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"\(.*\)".*/\1/')
PKG_DIR="src-tauri/target/release/bundle/pkg"

if [[ -f ".env.release" ]]; then
    set -a
    # shellcheck disable=SC1091
    source ".env.release"
    set +a
fi

if [[ -z "${APPLE_INSTALLER_SIGNING_IDENTITY:-}" ]]; then
    echo "Error: missing APPLE_INSTALLER_SIGNING_IDENTITY." >&2
    echo "Create a Developer ID Installer certificate and set APPLE_INSTALLER_SIGNING_IDENTITY in .env.release." >&2
    exit 1
fi

if ! security find-identity -v -p basic | grep -Fq "$APPLE_INSTALLER_SIGNING_IDENTITY"; then
    echo "Error: installer signing identity is not visible in this shell/keychain: $APPLE_INSTALLER_SIGNING_IDENTITY" >&2
    echo "Run: security find-identity -v -p basic" >&2
    exit 1
fi

productbuild_timestamp_arg=("--timestamp")
case "${PRODUCTBUILD_TIMESTAMP_MODE:-trusted}" in
    trusted)
        productbuild_timestamp_arg=("--timestamp")
        ;;
    none)
        productbuild_timestamp_arg=("--timestamp=none")
        ;;
    *)
        echo "Error: PRODUCTBUILD_TIMESTAMP_MODE must be 'trusted' or 'none'." >&2
        exit 1
        ;;
esac

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
            echo "Unsupported PKG architecture: $1" >&2
            echo "Usage: $0 [native|aarch64|x64|all]" >&2
            exit 1
            ;;
    esac
}

target_for_arch() {
    case "$1" in
        aarch64) echo "aarch64-apple-darwin" ;;
        x64) echo "x86_64-apple-darwin" ;;
    esac
}

run_productbuild_with_retry() {
    local app_src="$1"
    local pkg_path="$2"
    local max_attempts=3
    local attempt=1

    while ((attempt <= max_attempts)); do
        rm -f "$pkg_path"
        if productbuild \
            --component "$app_src" \
            /Applications \
            --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" \
            "${productbuild_timestamp_arg[@]}" \
            "$pkg_path"; then
            return 0
        fi

        if ((attempt == max_attempts)); then
            echo "Error: productbuild failed after ${max_attempts} attempts: $pkg_path" >&2
            return 1
        fi

        echo "productbuild attempt ${attempt} failed; retrying in 5 seconds..." >&2
        sleep 5
        attempt=$((attempt + 1))
    done
}

build_one() {
    local arch="$1"
    local target
    local app_src
    local pkg_path

    target=$(target_for_arch "$arch")
    app_src="src-tauri/target/${target}/release/bundle/macos/ADB Manager.app"
    pkg_path="$PKG_DIR/ADB_Manager_${VERSION}_${arch}.pkg"

    echo "=== Building ADB Manager v${VERSION} PKG for ${arch} (${target}) ==="

    if [[ ! -d "$app_src" ]]; then
        echo "Error: missing app bundle: $app_src" >&2
        echo "Run npm run build:dmg:apple, npm run build:dmg:intel, or npm run release:macos before building PKGs." >&2
        exit 1
    fi

    mkdir -p "$PKG_DIR"
    rm -f "$pkg_path"

    run_productbuild_with_retry "$app_src" "$pkg_path"

    pkgutil --check-signature "$pkg_path"
    echo "Output: $pkg_path"
    ls -lh "$pkg_path"
}

if [[ "${1:-native}" == "all" ]]; then
    mkdir -p "$PKG_DIR"
    rm -f "$PKG_DIR"/ADB_Manager_"${VERSION}"_*.pkg
    build_one "aarch64"
    build_one "x64"
else
    build_one "$(normalize_arch "${1:-native}")"
fi
