# Graph Report - adb_project  (2026-04-27)

## Corpus Check
- 29 files · ~7,868 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 84 nodes · 82 edges · 7 communities detected
- Extraction: 73% EXTRACTED · 27% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]

## God Nodes (most connected - your core abstractions)
1. `run_adb()` - 12 edges
2. `get_adb_path()` - 9 edges
3. `ensure_success()` - 5 edges
4. `adb_list_package_details()` - 5 edges
5. `adb_list_packages()` - 4 edges
6. `Platform Icon Set` - 4 edges
7. `run()` - 3 edges
8. `adb_package_info()` - 3 edges
9. `AdbError` - 2 edges
10. `get_bundled_adb_path()` - 2 edges

## Surprising Connections (you probably didn't know these)
- `HTML Entry Point` --references--> `ADB Manager App Icon`  [EXTRACTED]
  index.html → app-icon.png
- `get_adb_path()` --calls--> `adb_start_recording()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/record.rs
- `ADB Manager App Icon` --shares_data_with--> `Platform Icon Set`  [INFERRED]
  app-icon.png → src-tauri/icons/icon.png
- `run_adb()` --calls--> `adb_devices()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/device.rs
- `run_adb()` --calls--> `adb_pair()`  [INFERRED]
  src-tauri/src/adb.rs → src-tauri/src/commands/device.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.18
Nodes (10): run_adb(), adb_connect(), adb_devices(), adb_disconnect(), adb_pair(), DeviceInfo, adb_install(), adb_start_recording() (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.33
Nodes (8): AdbError, check_adb_available(), ensure_executable(), get_adb_path(), get_bundled_adb_path(), get_sdk_adb_path(), get_system_adb_path(), run_adb_with_stdin()

### Community 2 - "Community 2"
Cohesion: 0.39
Nodes (7): ensure_success(), adb_list_package_details(), adb_list_packages(), adb_package_info(), PackageInfo, parse_package_versions(), reveal_path()

### Community 3 - "Community 3"
Cohesion: 0.29
Nodes (3): run(), main(), AppState

### Community 4 - "Community 4"
Cohesion: 0.33
Nodes (6): ADB Manager App Icon, Android Launcher Icons, iOS App Icon Set, Platform Icon Set, Windows Tile Icons, HTML Entry Point

### Community 7 - "Community 7"
Cohesion: 0.5
Nodes (2): App(), useDevices()

### Community 8 - "Community 8"
Cohesion: 1.0
Nodes (2): getStore(), saveStoreValue()

## Knowledge Gaps
- **6 isolated node(s):** `DeviceInfo`, `PackageInfo`, `HTML Entry Point`, `Windows Tile Icons`, `iOS App Icon Set` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 7`** (4 nodes): `App()`, `App.tsx`, `useDevices.ts`, `useDevices()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 8`** (3 nodes): `storage.ts`, `getStore()`, `saveStoreValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run_adb()` connect `Community 0` to `Community 1`, `Community 2`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `ensure_success()` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `reveal_path()` connect `Community 2` to `Community 5`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `run_adb()` (e.g. with `adb_devices()` and `adb_pair()`) actually correct?**
  _`run_adb()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `ensure_success()` (e.g. with `adb_list_packages()` and `adb_package_info()`) actually correct?**
  _`ensure_success()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `adb_list_package_details()` (e.g. with `run_adb()` and `ensure_success()`) actually correct?**
  _`adb_list_package_details()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `adb_list_packages()` (e.g. with `run_adb()` and `ensure_success()`) actually correct?**
  _`adb_list_packages()` has 2 INFERRED edges - model-reasoned connections that need verification._