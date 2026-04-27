# Graph Report - /Users/kaizhang/Documents/Cozyla/adb_project  (2026-04-27)

## Corpus Check
- Corpus is ~7,236 words - fits in a single context window. You may not need a graph.

## Summary
- 105 nodes · 109 edges · 16 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_ADB Device Commands|ADB Device Commands]]
- [[_COMMUNITY_ADB Error Handling|ADB Error Handling]]
- [[_COMMUNITY_Tauri App Core|Tauri App Core]]
- [[_COMMUNITY_React App Shell|React App Shell]]
- [[_COMMUNITY_ADB Settings & Setup|ADB Settings & Setup]]
- [[_COMMUNITY_App Icon Assets|App Icon Assets]]
- [[_COMMUNITY_Package Management|Package Management]]
- [[_COMMUNITY_Format Utilities|Format Utilities]]
- [[_COMMUNITY_Screenshot Capture|Screenshot Capture]]
- [[_COMMUNITY_APK Installation|APK Installation]]
- [[_COMMUNITY_Screen Recording|Screen Recording]]
- [[_COMMUNITY_Pair & Connect|Pair & Connect]]
- [[_COMMUNITY_Device List UI|Device List UI]]
- [[_COMMUNITY_ADB Setup UI|ADB Setup UI]]
- [[_COMMUNITY_Type Definitions|Type Definitions]]
- [[_COMMUNITY_Vite Configuration|Vite Configuration]]

## God Nodes (most connected - your core abstractions)
1. `run_adb()` - 12 edges
2. `get_adb_path()` - 10 edges
3. `run()` - 4 edges
4. `Platform Icon Set` - 4 edges
5. `AdbError` - 3 edges
6. `get_bundled_adb_path()` - 3 edges
7. `get_system_adb_path()` - 3 edges
8. `get_sdk_adb_path()` - 3 edges
9. `ensure_executable()` - 3 edges
10. `run_adb_with_stdin()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `HTML Entry Point` --references--> `ADB Manager App Icon`  [EXTRACTED]
  index.html → app-icon.png
- `ADB Manager App Icon` --shares_data_with--> `Platform Icon Set`  [INFERRED]
  app-icon.png → src-tauri/icons/icon.png
- `adb_start_recording()` --calls--> `get_adb_path()`  [INFERRED]
  /Users/kaizhang/Documents/Cozyla/adb_project/src-tauri/src/commands/record.rs → /Users/kaizhang/Documents/Cozyla/adb_project/src-tauri/src/adb.rs
- `adb_list_packages()` --calls--> `run_adb()`  [INFERRED]
  /Users/kaizhang/Documents/Cozyla/adb_project/src-tauri/src/commands/package.rs → /Users/kaizhang/Documents/Cozyla/adb_project/src-tauri/src/adb.rs
- `adb_package_info()` --calls--> `run_adb()`  [INFERRED]
  /Users/kaizhang/Documents/Cozyla/adb_project/src-tauri/src/commands/package.rs → /Users/kaizhang/Documents/Cozyla/adb_project/src-tauri/src/adb.rs

## Communities

### Community 0 - "ADB Device Commands"
Cohesion: 0.22
Nodes (8): run_adb(), adb_connect(), adb_devices(), adb_disconnect(), adb_pair(), DeviceInfo, adb_install(), adb_screenshot()

### Community 1 - "ADB Error Handling"
Cohesion: 0.42
Nodes (8): AdbError, check_adb_available(), ensure_executable(), get_adb_path(), get_bundled_adb_path(), get_sdk_adb_path(), get_system_adb_path(), run_adb_with_stdin()

### Community 2 - "Tauri App Core"
Cohesion: 0.2
Nodes (3): run(), main(), AppState

### Community 3 - "React App Shell"
Cohesion: 0.33
Nodes (2): App(), useDevices()

### Community 4 - "ADB Settings & Setup"
Cohesion: 0.53
Nodes (4): check_adb_available(), get_default_save_dir(), install_adb(), select_directory()

### Community 5 - "App Icon Assets"
Cohesion: 0.33
Nodes (6): ADB Manager App Icon, Android Launcher Icons, iOS App Icon Set, Platform Icon Set, Windows Tile Icons, HTML Entry Point

### Community 6 - "Package Management"
Cohesion: 0.6
Nodes (3): adb_list_packages(), adb_package_info(), PackageInfo

### Community 7 - "Format Utilities"
Cohesion: 0.6
Nodes (3): formatDuration(), nowTimestamp(), truncatePackageName()

### Community 8 - "Screenshot Capture"
Cohesion: 0.67
Nodes (2): adb_start_recording(), adb_stop_recording()

### Community 9 - "APK Installation"
Cohesion: 0.67
Nodes (2): handleInstall(), handleSelectApk()

### Community 10 - "Screen Recording"
Cohesion: 0.67
Nodes (1): main()

### Community 11 - "Pair & Connect"
Cohesion: 0.67
Nodes (1): Settings()

### Community 12 - "Device List UI"
Cohesion: 0.67
Nodes (1): PairConnect()

### Community 13 - "ADB Setup UI"
Cohesion: 0.67
Nodes (1): Screenshot()

### Community 14 - "Type Definitions"
Cohesion: 0.67
Nodes (1): handleInstall()

### Community 15 - "Vite Configuration"
Cohesion: 0.67
Nodes (1): useAdb()

## Knowledge Gaps
- **4 isolated node(s):** `HTML Entry Point`, `Windows Tile Icons`, `iOS App Icon Set`, `Android Launcher Icons`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `React App Shell`** (6 nodes): `App()`, `App.tsx`, `useDevices.ts`, `useDevices()`, `App.tsx`, `useDevices.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Screenshot Capture`** (4 nodes): `adb_start_recording()`, `adb_stop_recording()`, `record.rs`, `record.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `APK Installation`** (4 nodes): `handleInstall()`, `handleSelectApk()`, `ApkInstall.tsx`, `ApkInstall.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Screen Recording`** (3 nodes): `main()`, `build.rs`, `build.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pair & Connect`** (3 nodes): `Settings()`, `Settings.tsx`, `Settings.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Device List UI`** (3 nodes): `PairConnect()`, `PairConnect.tsx`, `PairConnect.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ADB Setup UI`** (3 nodes): `Screenshot()`, `Screenshot.tsx`, `Screenshot.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Type Definitions`** (3 nodes): `handleInstall()`, `AdbSetup.tsx`, `AdbSetup.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Configuration`** (3 nodes): `useAdb.ts`, `useAdb()`, `useAdb.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run_adb()` connect `ADB Device Commands` to `Screenshot Capture`, `ADB Error Handling`, `Package Management`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `get_adb_path()` connect `ADB Error Handling` to `ADB Device Commands`, `Screenshot Capture`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `run_adb()` (e.g. with `adb_devices()` and `adb_pair()`) actually correct?**
  _`run_adb()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `run()` (e.g. with `.default()` and `main()`) actually correct?**
  _`run()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `Platform Icon Set` (e.g. with `ADB Manager App Icon` and `Windows Tile Icons`) actually correct?**
  _`Platform Icon Set` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `HTML Entry Point`, `Windows Tile Icons`, `iOS App Icon Set` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._