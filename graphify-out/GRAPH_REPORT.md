# Graph Report - adb_project  (2026-04-28)

## Corpus Check
- 33 files · ~18,505 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 141 nodes · 185 edges · 10 communities detected
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.8)
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
3. `ensure_success()` - 9 edges
4. `parse_binary_manifest_package()` - 6 edges
5. `parse_string_pool()` - 6 edges
6. `savePairConnect()` - 6 edges
7. `read_u16()` - 5 edges
8. `adb_mdns_discover()` - 4 edges
9. `adb_mdns_auto_connect()` - 4 edges
10. `parse_devices_output()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `HTML Entry Point` --references--> `ADB Manager App Icon`  [EXTRACTED]
  index.html → app-icon.png
- `run_adb()` --calls--> `adb_stop_recording()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/record.rs
- `ensure_success()` --calls--> `reveal_path()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/settings.rs
- `ADB Manager App Icon` --shares_data_with--> `Platform Icon Set`  [INFERRED]
  app-icon.png → src-tauri/icons/icon.png
- `get_adb_path()` --calls--> `adb_start_logcat()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/logcat.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.18
Nodes (16): run_adb(), adb_auto_connect(), adb_connect(), adb_devices(), adb_disconnect(), adb_mdns_auto_connect(), adb_mdns_discover(), adb_pair() (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.28
Nodes (14): acquire_install_lock(), adb_install(), extract_apk_package_name(), InstallGuard, parse_apk_package(), parse_binary_manifest_package(), parse_start_element_package(), parse_string_pool() (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.22
Nodes (11): AdbError, check_adb_available(), ensure_executable(), get_adb_path(), get_bundled_adb_path(), get_sdk_adb_path(), get_system_adb_path(), run_adb_with_env() (+3 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (11): ensure_success(), adb_input_text(), escape_adb_input_text(), adb_list_package_details(), adb_list_packages(), adb_package_info(), PackageInfo, parse_all_package_details() (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.31
Nodes (7): handleConnect(), handleMdnsConnect(), handleMdnsPair(), handlePair(), savePairConnect(), getStore(), saveStoreValue()

### Community 5 - "Community 5"
Cohesion: 0.36
Nodes (5): adb_read_logcat(), adb_start_logcat(), append_filter_args(), LogcatEntry, parse_logcat_line()

### Community 6 - "Community 6"
Cohesion: 0.36
Nodes (4): download_with_progress(), emit_install_progress(), install_adb(), reveal_path()

### Community 7 - "Community 7"
Cohesion: 0.29
Nodes (3): run(), main(), AppState

### Community 8 - "Community 8"
Cohesion: 0.33
Nodes (6): ADB Manager App Icon, Android Launcher Icons, iOS App Icon Set, Platform Icon Set, Windows Tile Icons, HTML Entry Point

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (2): App(), useDevices()

## Knowledge Gaps
- **8 isolated node(s):** `DeviceInfo`, `MdnsDevice`, `PackageInfo`, `LogcatEntry`, `HTML Entry Point` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 9`** (4 nodes): `App()`, `App.tsx`, `useDevices.ts`, `useDevices()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run_adb()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 5`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Why does `adb_install()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `ensure_success()` connect `Community 3` to `Community 0`, `Community 2`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `run_adb()` (e.g. with `adb_devices()` and `adb_mdns_discover()`) actually correct?**
  _`run_adb()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `get_adb_path()` (e.g. with `adb_start_logcat()` and `adb_start_recording()`) actually correct?**
  _`get_adb_path()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ensure_success()` (e.g. with `adb_mdns_discover()` and `adb_mdns_auto_connect()`) actually correct?**
  _`ensure_success()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DeviceInfo`, `MdnsDevice`, `PackageInfo` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._