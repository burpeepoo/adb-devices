# ADB Manager

ADB Manager is a desktop utility for Cozyla Android device workflows. It wraps common ADB tasks in a simple Tauri app so PMs, QA, and engineers can pair devices, install APKs, capture logs, take screenshots, record screens, and inspect packages without switching between terminal commands.

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
https://github.com/burpeepoo/Cozyla-adb-devices/releases
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

On macOS, the `.dmg` is generated under:

```text
src-tauri/target/release/bundle/dmg/
```

## Release Notes

Notable changes are tracked in `CHANGELOG.md`. Release builds are published through GitHub Releases.
