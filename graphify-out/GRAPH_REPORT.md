# Graph Report - adb_project  (2026-04-28)

## Corpus Check
- 34 files · ~43,738 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 163 nodes · 234 edges · 10 communities detected
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.8)
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
1. `run_adb()` - 16 edges
2. `get_adb_path()` - 11 edges
3. `run_adb_with_timeout()` - 10 edges
4. `ensure_success()` - 9 edges
5. `env()` - 7 edges
6. `main()` - 7 edges
7. `adb_mdns_auto_connect()` - 6 edges
8. `parse_binary_manifest_package()` - 6 edges
9. `parse_string_pool()` - 6 edges
10. `run_adb_with_env_timeout()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `env()` --calls--> `run_adb_with_env()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/adb.rs
- `env()` --calls--> `run_adb_with_env_timeout()`  [INFERRED]
  scripts/send-lark-release.mjs → src-tauri/src/adb.rs
- `HTML Entry Point` --references--> `ADB Manager App Icon`  [EXTRACTED]
  index.html → app-icon.png
- `run_adb()` --calls--> `adb_stop_recording()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/record.rs
- `ADB Manager App Icon` --shares_data_with--> `Platform Icon Set`  [INFERRED]
  app-icon.png → src-tauri/icons/icon.png

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (7): App(), handleNoteChange(), savePairConnect(), getStore(), saveStoreValue(), deviceIdentityKey(), useDevices()

### Community 1 - "Community 1"
Cohesion: 0.19
Nodes (19): run_adb(), run_adb_with_timeout(), adb_auto_connect(), adb_connect(), adb_devices(), adb_disconnect(), adb_mdns_auto_connect(), adb_mdns_discover() (+11 more)

### Community 2 - "Community 2"
Cohesion: 0.19
Nodes (14): AdbError, build_adb_command(), check_adb_available(), ensure_executable(), get_adb_path(), get_bundled_adb_path(), get_sdk_adb_path(), get_system_adb_path() (+6 more)

### Community 3 - "Community 3"
Cohesion: 0.28
Nodes (14): acquire_install_lock(), adb_install(), extract_apk_package_name(), InstallGuard, parse_apk_package(), parse_binary_manifest_package(), parse_start_element_package(), parse_string_pool() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.22
Nodes (12): ensure_success(), adb_input_text(), escape_adb_input_text(), adb_list_package_details(), adb_list_packages(), adb_package_info(), PackageInfo, parse_all_package_details() (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.47
Nodes (8): buildReleaseText(), collectReleaseFiles(), env(), getTenantAccessToken(), main(), parseLarkResponse(), sendMessage(), uploadFile()

### Community 6 - "Community 6"
Cohesion: 0.36
Nodes (5): adb_read_logcat(), adb_start_logcat(), append_filter_args(), LogcatEntry, parse_logcat_line()

### Community 7 - "Community 7"
Cohesion: 0.29
Nodes (3): run(), main(), AppState

### Community 8 - "Community 8"
Cohesion: 0.43
Nodes (3): download_with_progress(), emit_install_progress(), install_adb()

### Community 9 - "Community 9"
Cohesion: 0.33
Nodes (6): ADB Manager App Icon, Android Launcher Icons, iOS App Icon Set, Platform Icon Set, Windows Tile Icons, HTML Entry Point

## Knowledge Gaps
- **8 isolated node(s):** `DeviceInfo`, `MdnsDevice`, `PackageInfo`, `LogcatEntry`, `HTML Entry Point` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run_adb()` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `adb_install()` connect `Community 3` to `Community 1`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `ensure_success()` connect `Community 4` to `Community 1`, `Community 2`, `Community 6`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `run_adb()` (e.g. with `adb_list_packages()` and `adb_package_info()`) actually correct?**
  _`run_adb()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `get_adb_path()` (e.g. with `adb_start_logcat()` and `adb_start_recording()`) actually correct?**
  _`get_adb_path()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `run_adb_with_timeout()` (e.g. with `adb_devices()` and `adb_mdns_discover()`) actually correct?**
  _`run_adb_with_timeout()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ensure_success()` (e.g. with `adb_mdns_discover()` and `adb_mdns_auto_connect()`) actually correct?**
  _`ensure_success()` has 8 INFERRED edges - model-reasoned connections that need verification._