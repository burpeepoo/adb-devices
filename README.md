# ADB Manager

ADB Manager is a desktop utility for Android device workflows. It wraps common ADB tasks in a simple Tauri app so PMs, QA, and engineers can pair devices, install APKs, capture logs, take screenshots, record screens, and inspect packages without switching between terminal commands.

## Features

- Pair and connect Android devices over wireless ADB.
- Discover nearby wireless-debugging devices with mDNS.
- Keep a local device list with online/offline state and editable device notes.
- Install APK files, with optional force install by uninstalling the existing package first.
- **Screen mirroring** — open an interactive scrcpy window to control the device with mouse and keyboard, with one-click scrcpy install on macOS and Windows.
- Send text to the selected device input field.
- Take screenshots and reveal the saved file in Finder or Explorer.
- Start and stop screen recordings, then save the video locally.
- Read and filter recent Logcat output, then export logs to a text file.
- List installed package details including package name, version, serial number, and build number.

## Installation

Download the latest installer from the GitHub Releases page:

```text
https://github.com/burpeepoo/adb-devices/releases
```

### macOS

1. Download the `.dmg` file.
2. Open the `.dmg` and drag `ADB Manager.app` into `/Applications`.
3. Because the app is locally built and may not be notarized, remove the macOS quarantine attribute after installation:

```bash
xattr -dr com.apple.quarantine "/Applications/ADB Manager.app"
```

4. Launch `ADB Manager` from `/Applications`.

If macOS still blocks the app, open **System Settings > Privacy & Security** and allow the app from there.

### Windows

1. Download the `.exe` installer from the GitHub Release assets.
2. Run the installer.
3. Start `ADB Manager` from the Start menu or desktop shortcut.

If Windows SmartScreen warns about an unknown publisher, choose the advanced option only if the installer came from the official release page.

## Basic Usage

### Wireless Pairing

1. On the Android device, enable **Developer options**.
2. Open **Wireless debugging**.
3. Choose **Pair device with pairing code**.
4. In ADB Manager, use the **Pair / Connect** screen.
5. Either select a discovered mDNS pairing service or enter the IP, pairing port, and pairing code manually.

Pairing is usually needed only once per device. After that, use the connect port shown on the Android wireless-debugging screen.

### Device Selection

Connected devices appear in the left sidebar. Select a device before using APK install, screenshot, screen recording, clipboard, Logcat, or package tools.

Device notes are stored locally on the computer and are keyed by the device serial number when available.

### Screenshots and Recordings

Use **Settings** to choose default save folders. After a screenshot or recording is saved, use **Show in folder** to reveal the file.

### Screen Mirroring

Open **投屏控制** tab, select an online device, and click **开始投屏**. The app will automatically install scrcpy if needed (Homebrew on macOS, direct download on Windows). Once running, use mouse and keyboard to interact with the device, or click **返回** / **Home** to send navigation keys.

### Package Information

Open **Packages**, select a device, and click **Get package info**. The table can be sorted by package name, version, serial number, or build number.

## Development

Install dependencies:

```bash
npm install
```

Run the frontend dev server:

```bash
npm run dev
```

Run the Tauri app locally:

```bash
npm run tauri dev
```

Build and verify:

```bash
npm run build
cd src-tauri
cargo fmt -- --check
cargo test
```

Build local installers:

```bash
npm run tauri build
```

### macOS Release

Developer ID releases are built by a repeatable script that updates versions, signs bundled binaries, builds Apple Silicon and Intel DMGs, creates Tauri updater artifacts, notarizes DMGs, staples tickets, and runs Gatekeeper checks.

1. Copy `.env.release.example` to `.env.release`.
2. Fill in the local Apple Developer values. Keep the `.p8` key outside this repo.
3. Make sure the Tauri updater private key exists outside the repo. The default local path is:

```text
~/.tauri/adb-manager-updater.key
```

For GitHub Actions Windows release builds, set this repository secret:

```text
TAURI_SIGNING_PRIVATE_KEY
```

Use the private key content for GitHub Secrets. For local builds, `.env.release` can use the private key file path; the release script will read the file before calling Tauri:

```text
TAURI_SIGNING_PRIVATE_KEY="/Users/you/.tauri/adb-manager-updater.key"
```

If the key was generated with a password, also set:

```text
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

4. Run:

```bash
npm run release:macos -- 1.0.0
```

The final `.dmg` files are generated under:

```text
src-tauri/target/release/bundle/dmg/
```

macOS updater artifacts are generated under:

```text
src-tauri/target/release/bundle/updater/
```

After Windows release artifacts and `.sig` files are available, generate updater metadata:

```bash
npm run generate:updater-json -- 1.0.0
```

The updater prompt uses the release notes embedded in `latest.json`. Add simple bilingual notes before generating the metadata:

```text
release-notes/vX.Y.Z.txt
```

Use short plain text. Newer app versions display only the current UI language; older versions still show both lines without Markdown:

```text
en-US: Added update checks.
zh-CN: 新增更新检查。
```

Upload these updater assets to the same GitHub Release:

```text
ADB_Manager_X.Y.Z_aarch64.app.tar.gz
ADB_Manager_X.Y.Z_aarch64.app.tar.gz.sig
ADB_Manager_X.Y.Z_x64.app.tar.gz
ADB_Manager_X.Y.Z_x64.app.tar.gz.sig
ADB.Manager_X.Y.Z_x64-setup.exe
ADB.Manager_X.Y.Z_x64-setup.exe.sig
latest.json
```

The `.dmg`, `.exe`, and `.msi` assets remain the first-install downloads. `latest.json` points the installed app to the signed updater assets.

### Local Updater Test

To test the updater flow before publishing a real release, run:

```bash
./scripts/test-updater-local.sh
```

The script temporarily builds two local debug versions, restores the source files, opens the older test app, and serves a local `latest.json` from:

```text
http://127.0.0.1:18765/latest.json
```

Keep the terminal open, then use **Settings > Check for updates** in the opened test app.

## Release Notes

Notable changes are tracked in `CHANGELOG.md`. User-facing updater notes live in `release-notes/vX.Y.Z.txt` as short plain text with `en-US:` and `zh-CN:` lines.
