# Changelog

## [Unreleased]

## [1.1.28] - 2026-06-22

### Changed

- Changed wireless pairing `protocol fault` recovery to restart ADB while preserving this computer's wireless debugging identity instead of escalating directly to host identity reset.
- Changed successful wireless pairing to discover the device's current wireless debugging connect port, connect to it automatically when available, and remember the refreshed endpoint for future reconnects.

### Fixed

- Added a macOS mDNS fallback for devices that appear in system Bonjour discovery even when `adb mdns services` returns no wireless debugging entries.
- Improved wireless pairing and reconnect diagnostics so stale pairing ports and current connect ports are surfaced more clearly.

## [1.1.27] - 2026-06-18

### Added

- Added an explicit target-device guard across device actions, including Workbench execution, APK install, screenshots, recordings, scrcpy actions, image casting, clipboard input, Logcat refresh, and package export.
- Added Remote Control safety summaries for service state, network exposure, online roles, control ownership, stream settings, and trusted-device expiry.

### Changed

- Changed wireless recovery into a staged ladder from network and mDNS checks through recent endpoint probing, safe pairing repair, and confirmed host identity reset.
- Changed device action results and exports to include target-device identity, and updated Chinese and English copy to clarify that ADB Manager does not fall back to ADB's default device.

### Fixed

- Updated the Vite development dependency to a patched version before release packaging.

## [1.1.25] - 2026-06-11

### Fixed

- Hid Windows console windows for app-launched ADB commands, including logcat and screen recording child processes.

## [1.1.24] - 2026-05-29

### Changed

- Grouped Remote Control app drawer entries by the namespace after `com.` in the package name, with `com.elclcd.*` grouped under Cozyla.

### Fixed

- Fixed app drawer icon extraction for APKs that use adaptive icon XML, obfuscated resource paths, large string pools, or manifest attributes that require binary XML resource-map parsing.

## [1.1.23] - 2026-05-29

### Added

- Added a Remote Control app drawer that lists launchable apps for the selected device and starts apps directly through ADB.
- Added APK icon and label parsing for drawer apps, including a local icon cache for fast repeat loading.

### Changed

- Changed drawer app loading to show the app list first, then load icons progressively in the background.
- Changed app icon refresh to reuse cached icons immediately, revalidate stale entries after 24 hours, and rebuild entries when APK paths change or caches age out.
- Removed recent-app launch reordering so the drawer keeps a stable app-name order.

## [1.1.22] - 2026-05-28

### Added

- Added a standalone wireless pairing repair command that refreshes ADB wireless pairing state without resetting this computer's ADB host identity.
- Added CI test coverage before release packaging, including frontend logic tests, Rust formatting, and Rust tests.
- Added functional model documentation for product behavior, command mapping, release operations, and known risks.

### Changed

- Changed explicit ADB restart repair to back up and remove only `adb_known_hosts.pb` before restarting ADB, while preserving `adbkey` and `adbkey.pub`.
- Changed image preview loading to use a Rust validation command and data URL instead of broad home-directory asset protocol access.
- Simplified selected-device refresh tracking so device selection changes do not rebuild the device refresh callback.

### Fixed

- Fixed Windows clipboard APK path reading so non-macOS builds no longer try to run macOS `pbpaste`.
- Fixed screen recording state locking so a poisoned mutex returns a localized error instead of panicking.
- Removed broad `$HOME/**` asset protocol scope from the Tauri security config.

## [1.1.21] - 2026-05-27

### Changed

- Removed the continuous device-list polling that could keep refreshing the device console status and diagnostics.
- Limited device diagnostics refreshes to selected online serial changes instead of every device-list object refresh.

## [1.1.20] - 2026-05-27

### Changed

- Changed manual wireless connect, recent reconnect, and mDNS one-click connect to avoid implicit ADB server restarts during normal connection attempts.
- Kept ADB server restart limited to explicit repair actions such as "Restart ADB and rescan".

### Fixed

- Fixed startup ADB repair after app updates dropping an already-online wireless device offline a few seconds after launch.
- Normalized macOS ADB command environment so GUI-launched ADB Manager starts the ADB server with Homebrew and standard shell paths available.

## [1.1.19] - 2026-05-27

### Changed

- Prefer a host-installed ADB on macOS, including Homebrew and Android SDK locations, before falling back to the bundled ADB binary.

### Fixed

- Fixed in-app ADB restart starting a bundled ADB server that could keep wireless `adb connect` stuck on `No route to host` even when the same endpoint was reachable from the command line.
- Wait for the restarted ADB server port to actually come back before reporting restart success.

## [1.1.18] - 2026-05-27

### Fixed

- Replaced raw updater transport failures such as `error sending request for url` with a clear network/proxy message when GitHub cannot be reached.
- Kept malformed release-feed errors quiet while still surfacing real updater network failures with actionable copy.

## [1.1.17] - 2026-05-27

### Changed

- Changed recent wireless recovery so the first reconnect attempt keeps ADB restart and connect in a single backend operation before any mDNS scan or background refresh can intervene.
- Simplified recent wireless device actions to prefer "Restart ADB and reconnect" over a plain reconnect that is unreliable when the ADB server is already stale.

### Fixed

- Retried stale wireless transport failures one more time after a non-destructive ADB server restart, covering the case where the first in-app restart still leaves `adb connect` returning `No route to host`.

## [1.1.16] - 2026-05-27

### Fixed

- Retried recent wireless reconnects automatically after ADB reports retryable transport errors such as `No route to host`, instead of requiring a separate "Restart ADB and reconnect" click.
- Restarted the ADB server, rather than only starting it, when mDNS auto-connect hits a stale transport error on an already-running ADB server.

## [1.1.15] - 2026-05-27

### Fixed

- Serialized ADB device refresh, mDNS discovery, pairing, connection, and restart commands so startup repair after an update cannot race with background device polling.
- Fixed update-after-restart recovery leaving only an attempted startup repair state when the bundled ADB server start path failed during concurrent polling.

## [1.1.14] - 2026-05-27

### Added

- Added startup ADB server repair after app updates and later launches, with recent wireless endpoint reconnect and cooldown protection.

### Changed

- Changed ADB restart recovery back to a non-destructive server restart that preserves wireless pairing cache and local ADB identity.
- Updated wireless recovery copy to say "Restart ADB" instead of implying pairing cache cleanup.

### Fixed

- Retried wireless pairing automatically after protocol-fault and PairingClient transport errors by restarting the ADB server once.
- Hardened ADB server restart to wait for port 5037 to close and force-stop stuck ADB server processes when needed.

## [1.1.13] - 2026-05-26

### Added

- Added a separate local ADB identity reset action for wireless pairing failures that still persist after repair.

### Changed

- Changed ADB restart recovery to repair wireless pairing state first by clearing saved wireless pairing hosts while preserving the local ADB host key.
- Updated wireless reconnect recovery copy so the destructive identity reset is only presented after repair and reconnect attempts still fail.

## [1.1.12] - 2026-05-26

### Added

- Added a one-click parser in custom Workbench commands that rewrites multi-line `adb shell` batches for the currently selected device.

### Changed

- Kept Workbench risk detection active for rewritten quoted shell batches, including destructive `pm clear` commands and settings writes.

## [1.1.11] - 2026-05-26

### Changed

- Made the device list refresh every few seconds and refresh immediately when the app regains focus, so externally connected ADB devices appear quickly.
- Updated recent wireless reconnects to learn the current online ADB port from connected devices and prefer the latest port for the same IP address.

### Fixed

- Added an mDNS auto-connect fallback to single endpoint reconnects when Android changes the wireless debugging port.

## [1.1.10] - 2026-05-25

### Fixed

- Made ADB restart repair reconnect recent wireless endpoints automatically, including current mDNS ports when the Android wireless debugging port changes.
- Hardened manual wireless ADB connection retry by fully restarting the ADB server before retrying a failed connect attempt.
- Kept the selected device stable when the same physical device appears through both IP and mDNS ADB transports.

## [1.1.9] - 2026-05-25

### Fixed

- Treated invalid remote updater metadata as no available update so manual checks show the latest-version state instead of a raw release JSON error.

## [1.1.8] - 2026-05-25

### Added

- Added signed and notarized macOS PKG installers to the release workflow.

## [1.1.7] - 2026-05-22

### Added

- Added recent wireless ADB endpoint probing and reconnect fallback when LAN scanning finds no devices.

## [1.1.6] - 2026-05-22

### Added

- Added a first-pass Device Console with selected-device overview and shortcut navigation.
- Added editable device notes and live device status summaries to the Device Console.
- Added full tab labels in the left tool rail.
- Added device signing, verified boot, and build diagnostics to the Device Console.
- Added Device Console icons for status, diagnostics, and inferred device form factor.
- Added icons to the main functional area headers and Device Console section headers.

### Changed

- Merged Device Console status and diagnostics into collapsible sections inside the main device information card.
- Simplified the workspace header to show only the current device.

### Fixed

- Made long Device Console values reveal their full content faster on hover.
- Aligned functional area title spacing across workspace tabs.
- Kept visited tool tabs mounted so selected files and form inputs survive tab switches until the app closes.
- Raised the update prompt above Settings when opening update details from Settings.
- Preserved full local paths when pasting file or folder values into path-capable Workbench controls.

## [1.1.5] - 2026-05-22

### Changed

- Simplified the Settings update controls by removing explanatory subtitles and shortening the English manual update button label.

## [1.1.4] - 2026-05-21

### Added

- Added plain bilingual release note files as the source for in-app updater notes.
- Added release note extraction tests for updater metadata generation.
- Added app-language selection for updater notes in the update prompt.
- Added a GitHub repository icon at the bottom of the side tool rail.

### Changed

- Updater metadata now embeds `release-notes/vX.Y.Z.txt` content instead of a generic version string.
- The update prompt now labels the release notes section explicitly.
- Removed the GitHub repository link from the Settings dialog.

## [1.1.3] - 2026-05-21

### Added

- Added a red update indicator on the Settings button when a new version is available.
- Added an automatic update check setting, enabled by default, with silent startup checks and six-hour background checks while the app is open.

### Changed

- Automatic update checks now stay silent and surface available updates through the Settings indicator instead of opening the update dialog immediately.

## [1.1.2] - 2026-05-21

### Added

- Added Tauri updater configuration, signing key workflow, startup update prompts, Settings-based manual update checks, and GitHub Release `latest.json` generation.
- Added a muted app version label at the bottom of Settings.

### Changed

- Release packaging now prepares updater artifacts and requires a Tauri updater signing key in addition to existing Apple notarization credentials.

## [1.1.1] - 2026-05-21

### Added

- Added a global screen recording shortcut, Control + Shift + -, to start or stop recording while ADB Manager is running.
- Added a connected ADB device row for wireless LAN devices that are already connected but not present in the current mDNS results.

### Changed

- Changed Logcat level filtering from a single level selector to a multi-select level menu.
- Updated Remote Control mouse shortcut guidance and moved the Workbench custom command example into a localized placeholder.

## [1.1.0] - 2026-05-20

### Added

- Added Image Cast for pushing local PNG, JPG, JPEG, or WebP reference images to Android devices and opening them with the system image viewer.
- Added device-side media scan and open-last-image retry support for pushed reference images.

### Changed

- Renamed Screen Mirror to Remote Control in Chinese and English UI labels.
- Enabled local image previews through Tauri's asset protocol for selected Image Cast files.

## [1.0.3] - 2026-05-20

### Added

- Added a Mantine-based double-sidebar desktop shell with tool rail, searchable device panel, page header, workspace, and status bar.
- Added shared UI components for result alerts, command output, and path selection.

### Changed

- Refreshed Settings, Pair & Connect, Screenshot, and Screen Record screens with Mantine components.
- Updated tool rail icons so Screen Record uses the video icon and Screen Mirror uses a phone-and-computer device icon.

## [1.0.2] - 2026-05-20

### Added

- Added saved-template removal in ADB Workbench.
- Added a Workbench action for listing device directories before saving screenshots or recordings.

### Changed

- Stabilized the APK install layout with fixed drag area height, internal scrolling, and fixed-width queue controls.
- Replaced Workbench system-property examples with neutral placeholder values.

### Fixed

- Fixed Finder-copied APK or folder paste handling in the APK installer, including Cmd/Ctrl+V paste inside the tab.

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
