# Device File Manager Capability Contract

Last updated: 2026-08-24

## Capability Statement

ADB Manager gives an engineer or QA/support operator a selected-device file workspace. The operator can browse every path that the current ADB identity can enumerate, move host files into an accessible device directory, and export device files to an explicit host directory.

The promise is access-aware, not an assertion that ADB bypasses Android security:

> The file manager shows files accessible to the selected device, Android user, and current ADB identity. It does not represent every file physically stored on the device.

## User-Visible Promise

- Browse shared storage, media folders, downloads, documents, Android external data where the device permits it, `/data/local/tmp`, readable system paths, and any directly entered absolute path.
- See hidden entries, file type, size, modified time, and observed read/write signals.
- Navigate by row activation, breadcrumb, parent action, quick location, or absolute path entry.
- Paste files or directories copied in Finder/Explorer into the current writable device directory.
- Drag host files or directories into the current writable device directory.
- Select device files/directories and export them to a chosen host directory.
- Switch among connected devices through the existing device panel without any command falling back to an implicit ADB target.
- See the current path as the `设备目录` subtitle, use the breadcrumb row for navigation, and keep quick locations and direct path entry visible.
- Review every transfer in a File Transfer Center before it starts, including exact source paths and the destination.
- See the current item, item-level progress, elapsed time, and a real cancellation action while a batch is running.
- Resolve conflicts in the drawer per destination instead of accepting one batch-wide overwrite decision.
- Search/filter/sort the loaded directory and open a read-only details drawer from an explicit action or the row context menu.

## Capability Tiers

- `unavailable`: no explicit online serial or no usable ADB shell. Browsing and transfer are disabled.
- `shell`: standard ADB shell. Shared storage and shell-accessible paths are available; app-private data normally is not.
- `root`: the existing ADB shell is already UID 0. The file manager may reflect the additional observed access, but does not enable root itself.
- Package-scoped `run-as` is a separate future capability. It is not a global tier and is not part of this initial file tree.

Capability detection is refreshed per selected transport. A path can still be read-only or denied even when the overall shell tier is available.

## Fixed Invariants

- Every backend command requires a non-empty explicit `deviceSerial`.
- Directory shell commands quote all device paths as untrusted data. No user path is interpolated into a remote shell command without POSIX-safe quoting.
- `adb push` and `adb pull` use the sync command path and preserve host argv boundaries.
- The UI never silently changes the target directory, changes ADB identity, calls `adb root`, calls `su`, uses `run-as`, remounts a partition, changes SELinux, or unlocks a device.
- Existing files are never silently overwritten. Conflicts are returned as structured results and require an explicit whole-item replace action; directories are not merged into an existing tree.
- Conflict replacement is selected per source/destination row in the transfer drawer. A directory replacement remains a complete-item operation and is warned before retry.
- A failed transfer leaves the source intact and exposes the device/host error per item.
- File management does not add delete, move, rename, chmod, chown, remount, or recursive permission mutation.
- Special files, sockets, devices, and unknown entry types are visible when enumerable but cannot be copied as ordinary files.
- Listing is bounded and paginated. A large or timed-out directory returns an explicit partial/retry state, never a false empty state.
- Directory enumeration is streamed with NUL framing on the device; the shell does not expand the whole directory into one glob/argv before the page limit is applied.
- Recursive transfer planning is bounded by a safety budget of 64 directory levels, 25,000 planned entries, and 50 GiB per selected source; exceeding a budget returns a visible `transfer-limit` result instead of starting a partial copy.
- A transfer has a stable UI task id. Progress events can cancel the active ADB child process and leave already completed item results visible.

## Primary Surfaces And States

The File Manager is a first-class selected-device tool under the Apps/files navigation group and Device Console shortcuts.

Primary states:

- `blocked`: no explicit online device.
- `loading`: capability or directory request is in flight.
- `ready`: directory metadata and entries are available.
- `empty`: directory was read successfully and contains no entries.
- `partial`: more entries exist and can be loaded.
- `permission-denied`: the path exists or was requested but the current ADB identity cannot enumerate it.
- `not-found`: the requested absolute path does not exist or is no longer mounted.
- `transport-error`: the selected serial is offline, unauthorized, changed, or timed out.
- `transferring`: one host-to-device or device-to-host batch is active.
- `review`: a transfer batch is staged in the File Transfer Center and awaits confirmation.
- `conflict`: one or more destinations already exist and await an explicit replace decision.
- `cancelled`: the active ADB child was stopped; completed items remain recorded and remaining items were not started.
- `completed-with-errors`: a batch produced both successes and per-item failures.

Changing the selected serial clears selection and pagination, refreshes capabilities, and opens that device's preferred shared-storage root. It does not reuse a stale result from the previous device.

## Command Contract

- `adb_file_capabilities(deviceSerial)` returns ADB UID/build/user state and observed quick-location existence/read/write signals.
- `adb_file_list(deviceSerial, path, offset, limit)` returns canonical path metadata, typed entries, and `hasMore`.
- `adb_file_push(deviceSerial, localPaths, remoteDirectory, overwrite, transferId?)` validates local sources, checks remote conflicts, emits transfer progress, and returns per-item transfer results.
- `adb_file_pull(deviceSerial, remotePaths, localDirectory, overwrite, transferId?)` validates the local destination, checks local conflicts, sanitizes host-incompatible names when necessary, emits transfer progress, and returns per-item transfer results.
- `adb_file_cancel_transfer(transferId)` requests cancellation of the active ADB child for that task and returns whether the task was still active.
- `file-manager-transfer-progress` reports preparation, current source, current destination, item counts, elapsed time, completion, and cancellation.
- Existing `read_clipboard_local_paths` supplies host paths copied from Finder/Explorer for paste-to-device.

No response treats `test -w` as proof that a later write must succeed. Only the actual transfer result is authoritative.

## Scope Boundaries And Non-Goals

- No claim of access to `/data/data`, `/data/user/*`, decrypted credential-encrypted data before user unlock, or OEM-restricted external folders.
- No automatic or one-click root. Root, bootloader, recovery, remount, and SELinux changes require a separate explicitly authorized capability.
- No package-private `run-as` browser in this first slice.
- No remote preview/editor, media gallery, thumbnail generation, archive extraction, or content indexing.
- No delete, rename, move, permission editing, or device-to-device copy.
- No background synchronization or resumable transfer engine in the first slice.
- No adversarial concurrent-writer guarantee: the first slice revalidates both sides but does not install a device helper or replace ADB sync with held no-follow file handles.

## Acceptance Criteria

1. With no online selected device, all browse/transfer actions are blocked and no ADB command uses a default target.
2. With the current Android 15 test device selected, the user can browse `/storage/emulated/0`, its common media/document roots, `/data/local/tmp`, and readable `/system` paths.
   If the current Android user cannot be determined, the app reports it as unknown and does not silently substitute user 0 or generate shared-storage shortcuts.
3. A denied private path such as `/data/data` displays a permission explanation and does not appear empty.
4. Names containing spaces, quotes, Unicode, shell metacharacters, or leading dashes cannot alter the remote command.
5. Directory pages append without duplicates, reset on path/device change, and visibly indicate more results.
6. Finder/Explorer paste and host drag/drop push files/directories only to the visible current directory.
7. Existing remote targets produce conflicts; replacement occurs only after explicit confirmation.
8. Export to a chosen host directory pulls selected files/directories and reports each destination.
9. Existing local targets produce conflicts; replacement occurs only after explicit confirmation.
10. A confirmed directory conflict replaces that directory as a complete item after staged transfer; the UI warns that destination-only children will be removed.
11. A mixed batch reports successes, conflicts, and failures separately; source data remains intact.
12. The implementation uses hidden child-process helpers and passes the Windows no-console guard test.
13. English and Simplified Chinese cover navigation, states, permissions, conflict confirmation, and transfer outcomes.
14. Build, frontend tests, Rust formatting/tests, graph update, Tauri launch, and a uniquely scoped real-device push/list/pull/checksum smoke test provide completion evidence.
15. A non-zero remote shell result cannot be reported as success, and a transfer is successful only after the final destination is verified and its temporary stage is gone. Shared-storage filesystems that reject atomic exchange use the documented checked fallback.

## Current Device Evidence

Read-only probing on 2026-08-07 found one selected-device candidate at `10.0.0.80:46081` with stable serial `NCRN100027C`, Android 15/API 35, `user` build, shell UID 2000, SELinux Enforcing, unlocked Android user 0, and no `su`.

Observed:

- `/storage/emulated/0`, common media/document roots, `Android/data`, `Android/obb`, and `/data/local/tmp` were enumerable with positive read/write permission signals.
- `/system` was enumerable and read-only on an EROFS/root read-only mount.
- `/data/data`, `/data/user/0`, and `/data/media/0` were not enumerable by the current shell.

These are read-only capability signals, not yet proof of successful writes or transfers. The acceptance smoke test uses only a uniquely named temporary artifact and removes only that artifact after checksum verification.

## Open Follow-Ups

- Add a package-scoped `run-as` browser for explicitly selected debuggable apps.
- Decide whether a separately confirmed advanced root capability is valuable on userdebug devices, accounting for adbd restart/reboot risk.
