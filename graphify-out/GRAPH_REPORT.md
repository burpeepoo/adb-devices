# Graph Report - adb_project  (2026-04-30)

## Corpus Check
- 36 files · ~81,932 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 262 nodes · 437 edges · 13 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 13|Community 13]]

## God Nodes (most connected - your core abstractions)
1. `get_adb_path()` - 12 edges
2. `run_adb_with_timeout()` - 12 edges
3. `ensure_success()` - 12 edges
4. `run_adb()` - 10 edges
5. `start_screen_mirror()` - 9 edges
6. `env()` - 8 edges
7. `install_scrcpy_windows()` - 8 edges
8. `main()` - 7 edges
9. `run_adb_with_env_timeout()` - 7 edges
10. `emit_install_progress()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `env()` --calls--> `run_adb_with_env()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/adb.rs
- `env()` --calls--> `run_adb_with_env_timeout()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/adb.rs
- `env()` --calls--> `start_screen_mirror()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/commands/mirror.rs
- `HTML Entry Point` --references--> `ADB Manager App Icon`  [EXTRACTED]
  index.html → app-icon.png
- `get_adb_path()` --calls--> `adb_start_recording()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/record.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (24): client, core, handleNoteChange(), event, plugin_dialog, react, deviceIdentityKey(), users_kaizhang_documents_cozyla_adb_project_src_app (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (32): deserialize, acquire_install_lock(), capture_process_output(), check_scrcpy_available(), copy_dir_all(), current_screen_mirror_state(), download_with_progress(), emit_install_progress() (+24 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (24): build_adb_command(), run_adb_with_env_timeout(), run_adb_with_timeout(), wait_with_timeout(), adb_auto_connect(), adb_connect(), adb_devices(), adb_disconnect() (+16 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (22): adb, ensure_success(), run_adb(), apphandle, adb_input_text(), escape_adb_input_text(), local, send_navigation_key() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (8): fillConnectEndpoint(), handleConnectIpChange(), handleConnectPortChange(), parseConnectEndpoint(), savePairConnect(), plugin_store, getStore(), saveStoreValue()

### Community 5 - "Community 5"
Cohesion: 0.26
Nodes (15): acquire_install_lock(), adb_install(), extract_apk_package_name(), InstallGuard, parse_apk_package(), parse_binary_manifest_package(), parse_start_element_package(), parse_string_pool() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.24
Nodes (11): AdbError, check_adb_available(), ensure_executable(), get_adb_path(), get_bundled_adb_path(), get_sdk_adb_path(), get_system_adb_path(), run_adb_with_env() (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.35
Nodes (10): node_path, promises, buildReleaseText(), collectReleaseFiles(), env(), getTenantAccessToken(), main(), parseLarkResponse() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.21
Nodes (9): io, adb_read_logcat(), adb_start_logcat(), append_filter_args(), LogcatEntry, parse_logcat_line(), process, serialize (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (6): appstate, hashmap, run(), main(), mutex, AppState

### Community 10 - "Community 10"
Cohesion: 0.31
Nodes (5): download_with_progress(), emit_install_progress(), install_adb(), tauri, write

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (6): ADB Manager App Icon, Android Launcher Icons, iOS App Icon Set, Platform Icon Set, Windows Tile Icons, HTML Entry Point

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (2): plugin_react, vite

## Knowledge Gaps
- **11 isolated node(s):** `DeviceInfo`, `MdnsDevice`, `ScreenMirrorState`, `GithubRelease`, `GithubAsset` (+6 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 13`** (3 nodes): `plugin_react`, `vite`, `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `env()` connect `Community 7` to `Community 1`, `Community 2`, `Community 6`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `start_screen_mirror()` connect `Community 1` to `Community 6`, `Community 7`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `ensure_success()` connect `Community 3` to `Community 8`, `Community 1`, `Community 2`, `Community 6`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `get_adb_path()` (e.g. with `start_screen_mirror()` and `adb_start_logcat()`) actually correct?**
  _`get_adb_path()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `run_adb_with_timeout()` (e.g. with `adb_devices()` and `adb_mdns_discover()`) actually correct?**
  _`run_adb_with_timeout()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `ensure_success()` (e.g. with `adb_mdns_discover()` and `adb_mdns_auto_connect()`) actually correct?**
  _`ensure_success()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DeviceInfo`, `MdnsDevice`, `ScreenMirrorState` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._