# Changelog

## [0.1.5] - 2026-04-30

### Added

- 投屏控制页新增 scrcpy 操作提示：在 scrcpy 窗口中右键等同返回，中键等同 Home，并与 ADB Manager 内的返回/Home 按钮并列展示。
- 无线调试扫描为空时新增醒目的手动连接引导，提示用户从 Android 无线调试页面复制当前 IP 和端口。
- 手动连接支持粘贴完整地址（例如 `192.168.110.182:45723`）并自动拆分 IP 与端口。
- 扫描失败提示中显示最近一次成功连接的地址，并支持一键填入。

### Changed

- 左侧设备列表的选中态从窄竖条改为整行高亮卡片，增强当前设备的识别度。
- 自动连接未发现设备或失败时会自动展开手动连接区域，减少用户查找入口的成本。

### Fixed

- 修复在线设备转为离线后，离线列表仍显示选中框的问题。
- 修复离线设备仍可被点击选中的问题。
- 修复配对成功后旧的 mDNS pairing 广播仍导致配对码输入框继续显示的问题；同一设备已在线或已有可连接服务时不再显示配对输入框。

## [0.1.4] - 2026-04-29

### Added

- DMG helper installer script that copies ADB Manager to `/Applications`, removes the macOS quarantine attribute, and can launch the app after installation.
- Custom DMG build script that includes the installer command next to the app bundle.

### Changed

- Installer falls back to a macOS administrator prompt when `/Applications` requires elevated permissions.

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
