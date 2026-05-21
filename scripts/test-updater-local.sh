#!/bin/bash
# Build a local two-version updater test and serve latest.json from localhost.
set -euo pipefail

cd "$(dirname "$0")/.."

OLD_VERSION="${1:-99.0.0-test.1}"
NEW_VERSION="${2:-99.0.0-test.2}"
PORT="${3:-18765}"
ENDPOINT="http://127.0.0.1:${PORT}/latest.json"
TEST_ROOT="src-tauri/target/updater-test"
SERVER_DIR="${TEST_ROOT}/server"
OLD_APP_DIR="${TEST_ROOT}/old"
BACKUP_DIR="$(mktemp -d)"

case "$(uname -m)" in
    arm64 | aarch64)
        PLATFORM_KEY="darwin-aarch64"
        ASSET_ARCH="aarch64"
        ;;
    x86_64 | amd64)
        PLATFORM_KEY="darwin-x86_64"
        ASSET_ARCH="x64"
        ;;
    *)
        echo "Unsupported updater test architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

FILES_TO_RESTORE=(
    "package.json"
    "package-lock.json"
    "src-tauri/Cargo.toml"
    "src-tauri/Cargo.lock"
    "src-tauri/tauri.conf.json"
)

restore_sources() {
    for file in "${FILES_TO_RESTORE[@]}"; do
        if [[ -f "${BACKUP_DIR}/${file}" ]]; then
            mkdir -p "$(dirname "$file")"
            cp "${BACKUP_DIR}/${file}" "$file"
        fi
    done
}

cleanup_on_error() {
    restore_sources
    rm -rf "$BACKUP_DIR"
}
trap cleanup_on_error EXIT

for file in "${FILES_TO_RESTORE[@]}"; do
    mkdir -p "${BACKUP_DIR}/$(dirname "$file")"
    cp "$file" "${BACKUP_DIR}/${file}"
done

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY")"
    export TAURI_SIGNING_PRIVATE_KEY
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    if [[ -f "$HOME/.tauri/adb-manager-updater.key" ]]; then
        TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/adb-manager-updater.key")"
        export TAURI_SIGNING_PRIVATE_KEY
    else
        echo "Error: missing updater private key at $HOME/.tauri/adb-manager-updater.key" >&2
        exit 1
    fi
fi

: "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:=}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD

set_test_version_and_endpoint() {
    local version="$1"
    ./scripts/set-version.sh "$version"
    node - "$ENDPOINT" <<'NODE'
const fs = require("fs");
const endpoint = process.argv[2];
const configPath = "src-tauri/tauri.conf.json";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.plugins ??= {};
config.plugins.updater ??= {};
config.plugins.updater.endpoints = [endpoint];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
}

build_debug_app_bundle() {
    npm run tauri build -- --debug --bundles app
}

APP_BUNDLE="src-tauri/target/debug/bundle/macos/ADB Manager.app"
UPDATE_ARCHIVE="src-tauri/target/debug/bundle/macos/ADB Manager.app.tar.gz"
UPDATE_SIGNATURE="${UPDATE_ARCHIVE}.sig"
UPDATE_ASSET="ADB_Manager_${NEW_VERSION}_${ASSET_ARCH}.app.tar.gz"

echo "=== Building local old updater test app: ${OLD_VERSION} ==="
set_test_version_and_endpoint "$OLD_VERSION"
build_debug_app_bundle

rm -rf "$OLD_APP_DIR"
mkdir -p "$OLD_APP_DIR"
cp -R "$APP_BUNDLE" "$OLD_APP_DIR/"

echo "=== Building local update package: ${NEW_VERSION} ==="
set_test_version_and_endpoint "$NEW_VERSION"
build_debug_app_bundle

if [[ ! -f "$UPDATE_ARCHIVE" || ! -f "$UPDATE_SIGNATURE" ]]; then
    echo "Error: missing generated updater artifact or signature." >&2
    exit 1
fi

rm -rf "$SERVER_DIR"
mkdir -p "$SERVER_DIR"
cp "$UPDATE_ARCHIVE" "$SERVER_DIR/$UPDATE_ASSET"
cp "$UPDATE_SIGNATURE" "$SERVER_DIR/$UPDATE_ASSET.sig"

node - "$SERVER_DIR/latest.json" "$NEW_VERSION" "$PLATFORM_KEY" "$UPDATE_ASSET" "$PORT" <<'NODE'
const fs = require("fs");
const [outputPath, version, platformKey, assetName, port] = process.argv.slice(2);
const signature = fs.readFileSync(`${outputPath.replace(/latest\.json$/, "")}${assetName}.sig`, "utf8").trim();
const latest = {
  version,
  notes: `Local updater test build ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey]: {
      signature,
      url: `http://127.0.0.1:${port}/${encodeURIComponent(assetName)}`,
    },
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(latest, null, 2)}\n`);
NODE

restore_sources
rm -rf "$BACKUP_DIR"
trap - EXIT

echo "=== Local updater test is ready ==="
echo "Old app: ${OLD_APP_DIR}/ADB Manager.app"
echo "Feed: ${SERVER_DIR}/latest.json"
echo "URL: ${ENDPOINT}"
echo
echo "The old app will open now. In ADB Manager, open Settings and click Check for updates."
echo "Keep this terminal open while testing. Press Ctrl+C here when finished."

if [[ "${ADB_MANAGER_UPDATER_TEST_NO_OPEN:-}" != "1" ]]; then
    open "${OLD_APP_DIR}/ADB Manager.app"
fi

if [[ "${ADB_MANAGER_UPDATER_TEST_NO_SERVE:-}" == "1" ]]; then
    echo "Skipping local HTTP server because ADB_MANAGER_UPDATER_TEST_NO_SERVE=1."
    exit 0
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVER_DIR"
