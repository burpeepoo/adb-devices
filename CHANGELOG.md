# Changelog

## [0.1.3] - 2026-04-29

### Added

- **Screen mirroring** via scrcpy — open an interactive window to control the device with mouse and keyboard.
- One-click scrcpy installation on macOS (Homebrew) and Windows (direct download from GitHub Releases).
- Navigation key support — send Back and Home keys to the mirrored device.
- Mirroring status indicator on device list sidebar ("投屏中" badge).

### Changed

- mDNS-discovered wireless debugging devices now show connection type as "wireless" instead of "unknown".
- Improved pairing guide hint: users are now advised to ensure Wireless Debugging is enabled and to try switching Wi-Fi if the device is not found.

### Fixed

- Logcat level dropdown now has consistent height and alignment with adjacent filter inputs.

## [0.1.1] - 2026-04-28

### Changed

- Reduced click-time UI stalls by moving blocking ADB-backed Tauri commands onto async dispatch.
- Reused the app-level device list in the pair/connect screen instead of running a second periodic `adb_devices` refresh.

### Fixed

- Cached device serial number enrichment so routine device refreshes no longer run `adb shell getprop ro.serialno` for every known transport.
- Parsed serial numbers directly from mDNS ADB service names when available, avoiding unnecessary device shell calls.

## [0.1.0] - 2026-04-28

### Added

- ADB pair / connect / disconnect workflows (wireless + USB)
- mDNS auto-discovery for wireless ADB devices
- mDNS connection status indicator on device list
- Device list with online/offline sections
- Device note/name metadata (local-only, persisted in Tauri store)
- Clipboard tool for device
- Logcat viewer with readability improvements and export
- Package info viewer with optimized loading
- Step-by-step pairing guide (how to get pair code and connect address)
- GitHub Actions CI for macOS + Windows builds
- Feishu (Lark) release notification with dmg/exe delivery
- App icon assets

### Changed

- Device note input changed from always-visible input to click-to-edit pattern with Enter/Escape support
- ADB binary bundled and renamed for macOS compatibility
- mDNS availability messaging clarified

### Fixed

- ADB workflow reliability improvements
- Device selection UX improvements
