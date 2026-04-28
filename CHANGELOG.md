# Changelog

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
