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
require_env "APPLE_API_ISSUER"
require_env "APPLE_API_KEY"
require_env "APPLE_API_KEY_PATH"

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
    echo "Error: APPLE_API_KEY_PATH does not exist: $APPLE_API_KEY_PATH" >&2
    exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
    echo "Error: signing identity is not visible in this shell/keychain: $APPLE_SIGNING_IDENTITY" >&2
    echo "Run: security find-identity -v -p codesigning" >&2
    exit 1
fi

echo "=== Release ADB Manager v${VERSION} ==="
./scripts/set-version.sh "$VERSION"

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
    codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$binary"
    codesign --verify --strict --verbose=2 "$binary"
done

echo "=== Building app bundles and custom DMGs ==="
npm run build:dmg:all

DMG_DIR="src-tauri/target/release/bundle/dmg"
DMGS=(
    "$DMG_DIR/ADB_Manager_${VERSION}_aarch64.dmg"
    "$DMG_DIR/ADB_Manager_${VERSION}_x64.dmg"
)

echo "=== Signing and notarizing final DMGs ==="
for dmg in "${DMGS[@]}"; do
    if [[ ! -f "$dmg" ]]; then
        echo "Error: expected DMG was not generated: $dmg" >&2
        exit 1
    fi

    codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
    codesign --verify --verbose=2 "$dmg"

    xcrun notarytool submit "$dmg" \
        --key "$APPLE_API_KEY_PATH" \
        --key-id "$APPLE_API_KEY" \
        --issuer "$APPLE_API_ISSUER" \
        --wait

    xcrun stapler staple "$dmg"
    spctl -a -vvv -t open --context context:primary-signature "$dmg"
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
