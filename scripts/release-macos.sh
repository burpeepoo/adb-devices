#!/bin/bash
# Build, sign, notarize, staple, and verify macOS DMGs for both Apple Silicon and Intel.
set -euo pipefail

cd "$(dirname "$0")/.."

raw_version="${1:-}"
if [[ -z "$raw_version" ]]; then
    echo "Usage: $0 <version>" >&2
    echo "Example: $0 1.0.0" >&2
    exit 1
fi

VERSION="${raw_version#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
    echo "Error: version must look like 1.0.0 or v1.0.0, got: $raw_version" >&2
    exit 1
fi

if [[ -f ".env.release" ]]; then
    set -a
    # shellcheck disable=SC1091
    source ".env.release"
    set +a
fi

require_env() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Error: missing required environment variable: $name" >&2
        echo "Create .env.release from .env.release.example or export it before running." >&2
        exit 1
    fi
}

require_env "APPLE_SIGNING_IDENTITY"
require_env "APPLE_INSTALLER_SIGNING_IDENTITY"
require_env "APPLE_API_ISSUER"
require_env "APPLE_API_KEY"
require_env "APPLE_API_KEY_PATH"

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY")"
    export TAURI_SIGNING_PRIVATE_KEY
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    if [[ -f "$HOME/.tauri/adb-manager-updater.key" ]]; then
        TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/adb-manager-updater.key")"
        export TAURI_SIGNING_PRIVATE_KEY
    else
        echo "Error: missing Tauri updater signing key." >&2
        echo "Set TAURI_SIGNING_PRIVATE_KEY to the private key content or a readable private key file path before running the release." >&2
        exit 1
    fi
fi

: "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:=}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
    echo "Error: APPLE_API_KEY_PATH does not exist: $APPLE_API_KEY_PATH" >&2
    exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
    echo "Error: signing identity is not visible in this shell/keychain: $APPLE_SIGNING_IDENTITY" >&2
    echo "Run: security find-identity -v -p codesigning" >&2
    exit 1
fi

if ! security find-identity -v -p basic | grep -Fq "$APPLE_INSTALLER_SIGNING_IDENTITY"; then
    echo "Error: installer signing identity is not visible in this shell/keychain: $APPLE_INSTALLER_SIGNING_IDENTITY" >&2
    echo "Run: security find-identity -v -p basic" >&2
    exit 1
fi

notarytool_submit_with_retry() {
    local artifact="$1"
    local max_attempts=3
    local attempt=1

    while ((attempt <= max_attempts)); do
        if xcrun notarytool submit "$artifact" \
            --key "$APPLE_API_KEY_PATH" \
            --key-id "$APPLE_API_KEY" \
            --issuer "$APPLE_API_ISSUER" \
            --wait; then
            return 0
        fi

        if ((attempt == max_attempts)); then
            echo "Error: notarization failed after ${max_attempts} attempts: $artifact" >&2
            return 1
        fi

        echo "notarytool attempt ${attempt} failed for $artifact; retrying in 10 seconds..." >&2
        sleep 10
        attempt=$((attempt + 1))
    done
}

echo "=== Release ADB Manager v${VERSION} ==="
./scripts/set-version.sh "$VERSION"

codesign_timestamp_arg=("--timestamp")
if [[ -n "${APPLE_CODESIGN_TIMESTAMP_URL:-}" ]]; then
    codesign_timestamp_arg=("--timestamp=$APPLE_CODESIGN_TIMESTAMP_URL")
    export PATH="$PWD/scripts/release-shims:$PATH"
fi

SCRCPY_BINARIES=(
    "src-tauri/resources/scrcpy/macos-aarch64/scrcpy"
    "src-tauri/resources/scrcpy/macos-x86_64/scrcpy"
)

echo "=== Signing bundled scrcpy binaries ==="
for binary in "${SCRCPY_BINARIES[@]}"; do
    if [[ ! -x "$binary" ]]; then
        echo "Error: missing executable resource: $binary" >&2
        echo "Run ./scripts/prepare-scrcpy.sh before releasing." >&2
        exit 1
    fi
    codesign --force --options runtime "${codesign_timestamp_arg[@]}" --sign "$APPLE_SIGNING_IDENTITY" "$binary"
    codesign --verify --strict --verbose=2 "$binary"
done

echo "=== Building app bundles and custom DMGs ==="
npm run build:dmg:all

echo "=== Building signed PKG installers ==="
npm run build:pkg:all

DMG_DIR="src-tauri/target/release/bundle/dmg"
DMGS=(
    "$DMG_DIR/ADB_Manager_${VERSION}_aarch64.dmg"
    "$DMG_DIR/ADB_Manager_${VERSION}_x64.dmg"
)
PKG_DIR="src-tauri/target/release/bundle/pkg"
PKGS=(
    "$PKG_DIR/ADB_Manager_${VERSION}_aarch64.pkg"
    "$PKG_DIR/ADB_Manager_${VERSION}_x64.pkg"
)

echo "=== Signing and notarizing final DMGs ==="
for dmg in "${DMGS[@]}"; do
    if [[ ! -f "$dmg" ]]; then
        echo "Error: expected DMG was not generated: $dmg" >&2
        exit 1
    fi

    codesign --force "${codesign_timestamp_arg[@]}" --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
    codesign --verify --verbose=2 "$dmg"

    notarytool_submit_with_retry "$dmg"

    xcrun stapler staple "$dmg"
    spctl -a -vvv -t open --context context:primary-signature "$dmg"
done

echo "=== Notarizing final PKGs ==="
for pkg in "${PKGS[@]}"; do
    if [[ ! -f "$pkg" ]]; then
        echo "Error: expected PKG was not generated: $pkg" >&2
        exit 1
    fi

    pkgutil --check-signature "$pkg"

    notarytool_submit_with_retry "$pkg"

    xcrun stapler staple "$pkg"
    spctl -a -vvv -t install "$pkg"
done

echo "=== Verifying notarized app bundles ==="
APP_BUNDLES=(
    "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ADB Manager.app"
    "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/ADB Manager.app"
)

for app in "${APP_BUNDLES[@]}"; do
    if [[ ! -d "$app" ]]; then
        echo "Error: expected app bundle was not generated: $app" >&2
        exit 1
    fi
    codesign --verify --deep --strict --verbose=2 "$app"
    spctl -a -vvv -t execute "$app"
done

echo "=== Release artifacts ==="
for dmg in "${DMGS[@]}"; do
    ls -lh "$dmg"
done
for pkg in "${PKGS[@]}"; do
    ls -lh "$pkg"
done

echo "=== macOS updater artifacts ==="
ls -lh "src-tauri/target/release/bundle/updater/ADB_Manager_${VERSION}_aarch64.app.tar.gz" \
    "src-tauri/target/release/bundle/updater/ADB_Manager_${VERSION}_aarch64.app.tar.gz.sig" \
    "src-tauri/target/release/bundle/updater/ADB_Manager_${VERSION}_x64.app.tar.gz" \
    "src-tauri/target/release/bundle/updater/ADB_Manager_${VERSION}_x64.app.tar.gz.sig"
