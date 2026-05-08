# Graph Report - adb_project  (2026-05-08)

## Corpus Check
- 37 files · ~83,494 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 223 nodes · 374 edges · 10 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `run_adb_with_timeout()` - 14 edges
2. `ensure_success()` - 14 edges
3. `run_adb()` - 13 edges
4. `start_screen_mirror()` - 13 edges
5. `get_adb_path()` - 12 edges
6. `AppState` - 11 edges
7. `env()` - 8 edges
8. `install_scrcpy_windows()` - 8 edges
9. `adb_start_logcat()` - 8 edges
10. `adb_stop_recording()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `env()` --calls--> `run_adb_with_env()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/adb.rs
- `env()` --calls--> `run_adb_with_env_timeout()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/adb.rs
- `env()` --calls--> `start_screen_mirror()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/commands/mirror.rs
- `adb_disconnect()` --calls--> `run_adb_with_timeout()`  [INFERRED]
  src-tauri/src/commands/device.rs → src-tauri/src/adb.rs
- `open_external_url()` --calls--> `ensure_success()`  [INFERRED]
  src-tauri/src/commands/settings.rs → src-tauri/src/adb.rs

## Hyperedges (group relationships)
- **ADB Command Execution Variants** — adb_run_adb, adb_run_adb_with_timeout, adb_run_adb_with_env, adb_run_adb_with_env_timeout, adb_run_adb_with_stdin [INFERRED 0.90]
- **Start/Stop Long-Running Child Process Pattern** — mirror_start_screen_mirror, mirror_stop_screen_mirror, logcat_adb_start_logcat, logcat_adb_stop_logcat, record_adb_start_recording, record_adb_stop_recording [INFERRED 0.85]
- **RAII Mutex Guard for Concurrent Operation Prevention** — install_installguard, mirror_installguard, state_appstate [INFERRED 0.85]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (28): acquire_install_lock(), capture_process_output(), check_scrcpy_available(), copy_dir_all(), current_screen_mirror_state(), download_with_progress(), emit_install_progress(), emit_reader_lines() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (27): adb_auto_connect(), adb_connect(), adb_devices(), adb_disconnect(), adb_mdns_auto_connect(), adb_mdns_discover(), adb_restart_server(), connect_address() (+19 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (12): run(), adb_read_logcat(), adb_start_logcat(), adb_stop_logcat(), append_filter_args(), LogcatEntry, parse_logcat_line(), main() (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (10): AdbError, get_sdk_adb_path(), adb_screenshot(), download_with_progress(), emit_install_progress(), get_default_save_dir(), install_adb(), open_external_url() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.28
Nodes (14): acquire_install_lock(), adb_install(), extract_apk_package_name(), InstallGuard, parse_apk_package(), parse_binary_manifest_package(), parse_start_element_package(), parse_string_pool() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (6): fillConnectEndpoint(), handleConnectIpChange(), handleConnectPortChange(), savePairConnect(), getStore(), saveStoreValue()

### Community 6 - "Community 6"
Cohesion: 0.32
Nodes (13): build_adb_command(), check_adb_available(), ensure_executable(), get_adb_path(), get_bundled_adb_path(), get_system_adb_path(), run_adb(), run_adb_with_env() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.23
Nodes (12): ensure_success(), adb_input_text(), escape_adb_input_text(), send_navigation_key(), adb_list_package_details(), adb_list_packages(), adb_package_info(), PackageInfo (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.47
Nodes (8): buildReleaseText(), collectReleaseFiles(), env(), getTenantAccessToken(), main(), parseLarkResponse(), sendMessage(), uploadFile()

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (2): handleNoteChange(), deviceIdentityKey()

## Knowledge Gaps
- **7 isolated node(s):** `DeviceInfo`, `MdnsDevice`, `ScreenMirrorState`, `GithubRelease`, `GithubAsset` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 9`** (10 nodes): `commitEdit()`, `connectionClass()`, `connectionLabel()`, `handleNoteChange()`, `startEdit()`, `DeviceList.tsx`, `useDevices.ts`, `deviceDisplayTitle()`, `deviceIdentityKey()`, `useDevices()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run_adb()` connect `Community 6` to `Community 2`, `Community 3`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `ensure_success()` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 6`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `run_adb_with_timeout()` connect `Community 6` to `Community 0`, `Community 1`, `Community 7`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `run_adb_with_timeout()` (e.g. with `adb_restart_server()` and `adb_devices()`) actually correct?**
  _`run_adb_with_timeout()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `ensure_success()` (e.g. with `adb_mdns_discover()` and `adb_mdns_auto_connect()`) actually correct?**
  _`ensure_success()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `run_adb()` (e.g. with `adb_list_packages()` and `adb_package_info()`) actually correct?**
  _`run_adb()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `start_screen_mirror()` (e.g. with `get_adb_path()` and `env()`) actually correct?**
  _`start_screen_mirror()` has 6 INFERRED edges - model-reasoned connections that need verification._