# Changelog

## [1.0.1] - 2026-05-19

### Added

- Added ADB Workbench with a categorized ADB capability library, reusable templates, custom command execution, command history, and output export.
- Added Workbench actions for APK install, install-existing, screenshots, screen recording, file pull/push, permission listing, disk usage, and storage diagnostics.
- Added package-name search and selection for ADB Workbench package commands.
- Added APK folder drag-and-drop and clipboard paste detection for APK files or folders copied from Finder.
- Added a Settings language preference for following the system language, English, or Chinese.

### Changed

- Reworked ADB Workbench into an IDE-style layout with shell preview and output below the command builder.
- Sorted Workbench actions by risk from low to high and added category filtering.
- Separated saved templates into a dedicated My Templates area with an empty state and save confirmation.

### Fixed

- Reduced package-name search stalls and high memory use by avoiding hidden lookups and limiting search result processing.
- Reduced the initial height of the custom command input.

## [1.0.0] - 2026-05-19

### Added

- Added a repeatable macOS Developer ID release flow for version updates, signing, notarization, stapling, and verification.
- Added a modern blue ADB-themed app icon asset set.

### Changed

- Changed the macOS bundle identifier to `com.burpeepoo.adb-manager`.
- Release packaging now signs bundled macOS `scrcpy` binaries before app notarization.
- macOS DMGs now contain only `ADB Manager.app` and the `/Applications` shortcut.

## [0.1.11] - 2026-05-15

### Added

- Added multi-APK selection and drag-and-drop support in the APK installer.
- Added a sequential install queue with per-APK status, progress, and completion summary.

### Changed

- APK installation now continues to the next selected APK after an individual install failure.
- Force install now supports multi-APK queues with a package name field for each APK.

## [0.1.10] - 2026-05-15

### Added

- Added APK export from the Package tab, including support for packages installed as split APKs.
- Added separate macOS DMG builds for Apple Silicon and Intel Macs.

### Changed

- Release packaging now uses architecture-specific DMG commands while keeping `install.command` bundled in every macOS installer.
- GitHub Actions now uploads separate `aarch64` and `x64` macOS DMG artifacts for release publishing.

## [0.1.9] - 2026-05-13

### Added

- Added a restart ADB recovery action after repeated pair or connect failures.
- Added a single-command DMG build path that produces one macOS DMG containing both the app and `install.command`.

### Changed

- macOS package builds now upload only the custom DMG artifact instead of both the app bundle and a default Tauri DMG.

### Fixed

- APK package-name parsing failures no longer show an immediate red error after selecting a file; the warning is only shown when force install is enabled.

## [0.1.8] - 2026-05-08

### Added

- Added a restart ADB action directly on pairing failures, so users can recover stale pairing sessions without leaving the Pair & Connect tab.
- Added a screen mirroring audio capture toggle. Audio capture is off by default and can be enabled manually when the device supports scrcpy audio forwarding.

### Changed

- Screen mirroring now starts with scrcpy audio disabled by default to avoid immediate exits on Android devices that cannot create an `AudioRecord`.
- LAN wireless debugging scan results are filtered to the Mac's current local IPv4 subnet, preventing stale mDNS results from a previous Wi-Fi network from appearing as connectable devices.
- Pair & Connect now refreshes local IPv4 addresses periodically so switching Wi-Fi updates the visible scan results automatically.

### Fixed

- Fixed scrcpy startup failures caused by device-side audio capture errors such as `Cannot create AudioRecord`.
- Fixed stale wireless debugging scan entries remaining visible after switching Wi-Fi networks.

## [0.1.7] - 2026-05-08

### Added

- Added a screenshot-and-preview action that saves a screenshot and opens the image file for immediate review.
- Added a screenshot shortcut hint for macOS and Windows. `Control/Ctrl + Shift + 0` now takes a screenshot without opening preview.
- Added an ADB recovery action for wireless scanning: users can restart the ADB server and rescan when no LAN devices are discovered.
- Added multi-network guidance when the computer has multiple local IPv4 addresses, helping users match the Android wireless debugging subnet.

### Changed

- Manual wireless connection now retries once after starting the ADB server when the first `adb connect` attempt fails.
- One-click mDNS connection now also retries after starting the ADB server before reporting a connection failure.

### Fixed

- Fixed screenshot preview handling by opening the saved file through the desktop instead of relying on an inline asset preview.
- Improved wireless debugging recovery for cases where ADB mDNS discovery stops seeing devices after switching between USB and wireless workflows.

## [0.1.6] - 2026-05-07

### Added

- 新增中英文多语言支持，前端默认根据系统语言显示中文或英文。
- 新增后端文案本地化，ADB、安装、投屏、截图、录屏、Logcat 和包管理相关错误会跟随应用语言。
- 新增英语兜底策略：无法识别的系统语言统一显示英文。

### Changed

- README 去除 Cozyla 品牌描述，改为通用 Android device workflows 说明。
- 投屏控制提示将 “scrcpy 右键 / scrcpy 中键” 改为更易懂的 “鼠标右键 / 鼠标中键”。
- Logcat、包管理、无线连接、投屏控制等页面补齐中英文界面文案和占位提示。

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
