use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use crate::adb::{self, AdbError};

const DEFAULT_DIRECTORY_PAGE_SIZE: usize = 250;
const MAX_DIRECTORY_PAGE_SIZE: usize = 1000;
const DIRECTORY_LIST_TIMEOUT: Duration = Duration::from_secs(20);
const CAPABILITY_TIMEOUT: Duration = Duration::from_secs(12);
const PATH_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const FILE_TRANSFER_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_TRANSFER_DEPTH: usize = 64;
const MAX_TRANSFER_ITEMS: usize = 25_000;
const MAX_TRANSFER_TOTAL_BYTES: u64 = 50 * 1024 * 1024 * 1024;
const REMOTE_PLAN_PAGE_SIZE: usize = MAX_DIRECTORY_PAGE_SIZE;

static TRANSFER_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);

const CAPABILITY_PATHS: &[&str] = &[
    "@current-user-storage",
    "@current-user-storage/DCIM",
    "@current-user-storage/Pictures",
    "@current-user-storage/Movies",
    "@current-user-storage/Music",
    "@current-user-storage/Download",
    "@current-user-storage/Documents",
    "@current-user-storage/Android/data",
    "@current-user-storage/Android/obb",
    "/data/local/tmp",
    "/system",
    "/data",
    "/",
];

const CAPABILITY_SCRIPT: &str = r#"
uid=$(id -u 2>/dev/null || true)
build_type=$(getprop ro.build.type 2>/dev/null || true)
debuggable=$(getprop ro.debuggable 2>/dev/null || true)
android_user=$(am get-current-user 2>/dev/null || true)
case "$android_user" in
  ''|*[!0-9]*) android_user='' ;;
esac
android_user_known=0
android_user_state=''
if [ -n "$android_user" ]; then
  android_user_known=1
  android_user_state=$(cmd user get-user-state "$android_user" 2>/dev/null || true)
fi

printf 'C\000%s\000%s\000%s\000%s\000%s\000%s\000' \
  "$uid" "$build_type" "$debuggable" "$android_user" "$android_user_known" "$android_user_state"

for path in "$@"; do
  case "$path" in
    @current-user-storage)
      [ "$android_user_known" -eq 1 ] || continue
      path="/storage/emulated/$android_user"
      ;;
    @current-user-storage/*)
      [ "$android_user_known" -eq 1 ] || continue
      suffix=${path#@current-user-storage}
      path="/storage/emulated/$android_user$suffix"
      ;;
  esac
  exists=0
  readable=0
  writable=0
  if [ -e "$path" ] || [ -L "$path" ]; then
    exists=1
  fi
  [ -r "$path" ] && readable=1
  [ -w "$path" ] && writable=1
  printf 'R\000%s\000%s\000%s\000%s\000' "$path" "$exists" "$readable" "$writable"
done
"#;

const DIRECTORY_PROBE_SCRIPT: &str = r#"
path=$1
if [ ! -e "$path" ] && [ ! -L "$path" ]; then
  printf 'FM_NOT_FOUND:%s' "$path" >&2
  exit 44
fi
if [ ! -d "$path" ]; then
  printf 'FM_NOT_DIRECTORY:%s' "$path" >&2
  exit 45
fi
if [ -L "$path" ]; then
  printf 'FM_UNSAFE_SYMLINK:%s' "$path" >&2
  exit 47
fi
if ! cd -P "$path" 2>/dev/null; then
  printf 'FM_PERMISSION_DENIED:%s' "$path" >&2
  exit 46
fi
printf '%s\000' "$PWD"
"#;

const REMOTE_COMMIT_NO_CLOBBER_SCRIPT: &str = r#"
stage=$1
destination=$2
expected_kind=$3
if [ ! -e "$stage" ] && [ ! -L "$stage" ]; then
  printf 'FM_STAGE_MISSING:%s' "$stage" >&2
  exit 48
fi
if [ -L "$stage" ]; then
  printf 'FM_UNSAFE_SYMLINK:%s' "$stage" >&2
  exit 47
fi
if [ -e "$destination" ] || [ -L "$destination" ]; then
  printf 'FM_CONFLICT:%s' "$destination" >&2
  exit 73
fi

case "$expected_kind" in
  file)
    [ -f "$stage" ] || { printf 'FM_TYPE_MISMATCH:%s' "$stage" >&2; exit 74; }
    if ! (set -C; : > "$destination") 2>/dev/null; then
      printf 'FM_CONFLICT:%s' "$destination" >&2
      exit 73
    fi
    ;;
  directory)
    [ -d "$stage" ] || { printf 'FM_TYPE_MISMATCH:%s' "$stage" >&2; exit 74; }
    if ! mkdir "$destination" 2>/dev/null; then
      printf 'FM_CONFLICT:%s' "$destination" >&2
      exit 73
    fi
    ;;
  *) printf 'FM_TYPE_MISMATCH:%s' "$destination" >&2; exit 74 ;;
esac
placeholder_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
if [ -z "$placeholder_id" ]; then
  printf 'FM_BACKUP_LEFT:%s' "$destination" >&2
  exit 81
fi
remove_placeholder() {
  current_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  [ "$current_id" = "$placeholder_id" ] || return 1
  case "$expected_kind" in
    file) rm -f -- "$destination" 2>/dev/null ;;
    directory) rmdir -- "$destination" 2>/dev/null ;;
  esac
  [ ! -e "$destination" ] && [ ! -L "$destination" ]
}
payload_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
if [ -z "$payload_id" ]; then
  if ! remove_placeholder; then
    printf 'FM_BACKUP_LEFT:%s' "$destination" >&2
    exit 81
  fi
  printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$stage" >&2
  exit 79
fi

exchange_supported=0
if mv --help 2>&1 | grep -Eq -- '\[[^]]*x[^]]*\]|-x'; then
  exchange_supported=1
fi
commit_mode=fallback
if [ "$exchange_supported" -eq 1 ] && mv -xT -- "$stage" "$destination" 2>/dev/null; then
  destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  destination_valid=0
  case "$expected_kind" in
    file) [ ! -L "$destination" ] && [ -f "$destination" ] && destination_valid=1 ;;
    directory) [ ! -L "$destination" ] && [ -d "$destination" ] && destination_valid=1 ;;
  esac
  stage_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
  if [ "$destination_valid" -ne 1 ] || [ "$destination_id" != "$payload_id" ] || [ "$stage_id" != "$placeholder_id" ]; then
    if [ "$destination_id" = "$payload_id" ] && [ "$stage_id" = "$placeholder_id" ]; then
      mv -xT -- "$stage" "$destination" 2>/dev/null || true
    fi
    restored_payload_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
    restored_placeholder_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
    if [ "$restored_payload_id" = "$payload_id" ] && [ "$restored_placeholder_id" = "$placeholder_id" ]; then
      if ! remove_placeholder; then
        printf 'FM_BACKUP_LEFT:%s' "$destination" >&2
        exit 81
      fi
      printf 'FM_SOURCE_CHANGED:%s' "$stage" >&2
      exit 80
    fi
    printf 'FM_ROLLBACK_FAILED:%s' "$stage" >&2
    exit 82
  fi
  case "$expected_kind" in
    file) rm -f -- "$stage" 2>/dev/null ;;
    directory) rmdir -- "$stage" 2>/dev/null ;;
  esac
  if [ -e "$stage" ] || [ -L "$stage" ]; then
    printf 'FM_BACKUP_LEFT:%s' "$stage" >&2
    exit 81
  fi
  commit_mode=exchange
else
  current_payload_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
  current_placeholder_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  if [ "$current_payload_id" != "$payload_id" ] || [ "$current_placeholder_id" != "$placeholder_id" ]; then
    if [ "$current_placeholder_id" = "$placeholder_id" ]; then
      if ! remove_placeholder; then
        printf 'FM_BACKUP_LEFT:%s' "$destination" >&2
        exit 81
      fi
    fi
    printf 'FM_SOURCE_CHANGED:%s' "$stage" >&2
    exit 80
  fi
  if ! remove_placeholder; then
    printf 'FM_CONFLICT:%s' "$destination" >&2
    exit 73
  fi
  if ! mv -nT -- "$stage" "$destination" 2>/dev/null; then
    printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
    exit 79
  fi
  destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  if [ "$destination_id" != "$payload_id" ] || [ -e "$stage" ] || [ -L "$stage" ]; then
    if [ -e "$destination" ] || [ -L "$destination" ]; then
      printf 'FM_CONFLICT:%s' "$destination" >&2
    else
      printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
    fi
    exit 79
  fi
fi
printf 'ok:%s' "$commit_mode"
"#;

const REMOTE_COMMIT_REPLACE_SCRIPT: &str = r#"
stage=$1
destination=$2
expected_kind=$3

if [ ! -e "$stage" ] && [ ! -L "$stage" ]; then
  printf 'FM_STAGE_MISSING:%s' "$stage" >&2
  exit 48
fi
if [ -L "$stage" ]; then
  printf 'FM_UNSAFE_SYMLINK:%s' "$stage" >&2
  exit 47
fi
if [ -L "$destination" ]; then
  printf 'FM_UNSAFE_SYMLINK:%s' "$destination" >&2
  exit 47
fi
if [ ! -e "$destination" ]; then
  printf 'FM_CONFLICT:%s' "$destination" >&2
  exit 73
fi
case "$expected_kind" in
  file)
    [ -f "$stage" ] || { printf 'FM_TYPE_MISMATCH:%s' "$stage" >&2; exit 74; }
    [ -f "$destination" ] || { printf 'FM_TYPE_MISMATCH:%s' "$destination" >&2; exit 74; }
    ;;
  directory)
    [ -d "$stage" ] || { printf 'FM_TYPE_MISMATCH:%s' "$stage" >&2; exit 74; }
    [ -d "$destination" ] || { printf 'FM_TYPE_MISMATCH:%s' "$destination" >&2; exit 74; }
    ;;
  *) printf 'FM_TYPE_MISMATCH:%s' "$destination" >&2; exit 74 ;;
esac
payload_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
if [ -z "$payload_id" ] || [ -z "$destination_id" ]; then
  printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
  exit 79
fi
exchange_supported=0
if mv --help 2>&1 | grep -Eq -- '\[[^]]*x[^]]*\]|-x'; then
  exchange_supported=1
fi
commit_mode=fallback
if [ "$exchange_supported" -eq 1 ] && mv -xT -- "$stage" "$destination" 2>/dev/null; then
  new_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  new_stage_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
  if [ "$new_destination_id" != "$payload_id" ] || [ "$new_stage_id" != "$destination_id" ]; then
    mv -xT -- "$stage" "$destination" 2>/dev/null || true
    restored_stage_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
    restored_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
    restored_stage_valid=0
    restored_destination_valid=0
    case "$expected_kind" in
      file)
        [ ! -L "$stage" ] && [ -f "$stage" ] && restored_stage_valid=1
        [ ! -L "$destination" ] && [ -f "$destination" ] && restored_destination_valid=1
        ;;
      directory)
        [ ! -L "$stage" ] && [ -d "$stage" ] && restored_stage_valid=1
        [ ! -L "$destination" ] && [ -d "$destination" ] && restored_destination_valid=1
        ;;
    esac
    if [ "$restored_stage_id" = "$payload_id" ] \
      && [ "$restored_destination_id" = "$destination_id" ] \
      && [ "$restored_stage_valid" -eq 1 ] \
      && [ "$restored_destination_valid" -eq 1 ]; then
      printf 'FM_SOURCE_CHANGED:%s' "$destination" >&2
      exit 80
    fi
    printf 'FM_ROLLBACK_FAILED:%s' "$stage" >&2
    exit 82
  fi
  case "$expected_kind" in
    file) rm -f -- "$stage" 2>/dev/null ;;
    directory) rm -rf -- "$stage" 2>/dev/null ;;
  esac
  if [ -e "$stage" ] || [ -L "$stage" ]; then
    printf 'FM_BACKUP_LEFT:%s' "$stage" >&2
    exit 81
  fi
  commit_mode=exchange
else
  backup="${stage}.backup"
  if [ -e "$backup" ] || [ -L "$backup" ]; then
    printf 'FM_CONFLICT:%s' "$backup" >&2
    exit 73
  fi
  current_payload_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
  current_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  if [ "$current_payload_id" != "$payload_id" ] || [ "$current_destination_id" != "$destination_id" ]; then
    printf 'FM_SOURCE_CHANGED:%s' "$destination" >&2
    exit 80
  fi
  if ! mv -nT -- "$destination" "$backup" 2>/dev/null; then
    printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
    exit 79
  fi
  backup_id=$(stat -c '%d:%i' "$backup" 2>/dev/null || true)
  if [ "$backup_id" != "$destination_id" ] || [ -e "$destination" ] || [ -L "$destination" ]; then
    current_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
    if [ "$backup_id" = "$destination_id" ] && [ -z "$current_destination_id" ]; then
      mv -nT -- "$backup" "$destination" 2>/dev/null || true
      current_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
      if [ "$current_destination_id" = "$destination_id" ] && [ ! -e "$backup" ] && [ ! -L "$backup" ]; then
        printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
        exit 79
      fi
    elif [ "$current_destination_id" = "$destination_id" ] && [ ! -e "$backup" ] && [ ! -L "$backup" ]; then
      printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
      exit 79
    fi
    printf 'FM_ROLLBACK_FAILED:%s' "$backup" >&2
    exit 82
  fi
  fallback_failed=0
  mv -nT -- "$stage" "$destination" 2>/dev/null || fallback_failed=1
  new_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
  if [ "$fallback_failed" -ne 0 ] || [ "$new_destination_id" != "$payload_id" ] || [ -e "$stage" ] || [ -L "$stage" ]; then
    if [ "$new_destination_id" = "$payload_id" ] && [ ! -e "$stage" ] && [ ! -L "$stage" ]; then
      mv -nT -- "$destination" "$stage" 2>/dev/null || true
    fi
    restored_stage_id=$(stat -c '%d:%i' "$stage" 2>/dev/null || true)
    restored_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
    if [ "$restored_stage_id" = "$payload_id" ] && [ -z "$restored_destination_id" ]; then
      mv -nT -- "$backup" "$destination" 2>/dev/null || true
    fi
    restored_destination_id=$(stat -c '%d:%i' "$destination" 2>/dev/null || true)
    if [ "$restored_destination_id" = "$destination_id" ] && [ ! -e "$backup" ] && [ ! -L "$backup" ]; then
      printf 'FM_ATOMIC_COMMIT_FAILED:%s' "$destination" >&2
      exit 79
    fi
    printf 'FM_ROLLBACK_FAILED:%s' "$backup" >&2
    exit 82
  fi
  current_backup_id=$(stat -c '%d:%i' "$backup" 2>/dev/null || true)
  if [ "$current_backup_id" != "$destination_id" ]; then
    printf 'FM_SOURCE_CHANGED:%s' "$backup" >&2
    exit 80
  fi
  case "$expected_kind" in
    file) rm -f -- "$backup" 2>/dev/null ;;
    directory) rm -rf -- "$backup" 2>/dev/null ;;
  esac
  if [ -e "$backup" ] || [ -L "$backup" ]; then
    printf 'FM_BACKUP_LEFT:%s' "$backup" >&2
    exit 81
  fi
fi
printf 'ok:%s' "$commit_mode"
"#;

const REMOTE_REMOVE_STAGE_SCRIPT: &str = r#"
stage=$1
case "$stage" in
  */.adb-manager-stage-*) rm -rf -- "$stage" ;;
  *) printf 'FM_UNSAFE_STAGE:%s' "$stage" >&2; exit 76 ;;
esac
"#;

const PATH_KIND_SCRIPT: &str = r#"
path=$1
if [ -L "$path" ]; then
  printf 'symlink'
elif [ -d "$path" ]; then
  printf 'directory'
elif [ -f "$path" ]; then
  printf 'file'
elif [ -e "$path" ]; then
  printf 'other'
else
  printf 'missing'
fi
"#;

const REGULAR_FILE_SIZE_SCRIPT: &str = r#"
path=$1
if [ -L "$path" ]; then
  printf 'FM_UNSAFE_SYMLINK:%s' "$path" >&2
  exit 47
fi
if [ ! -e "$path" ]; then
  printf 'FM_NOT_FOUND:%s' "$path" >&2
  exit 44
fi
if [ ! -f "$path" ]; then
  printf 'FM_TYPE_MISMATCH:%s' "$path" >&2
  exit 74
fi
size=$(stat -c %s "$path" 2>/dev/null || true)
case "$size" in
  ''|*[!0-9]*) printf 'FM_STAT_FAILED:%s' "$path" >&2; exit 77 ;;
esac
printf '%s' "$size"
"#;

const DIRECTORY_LIST_SCRIPT: &str = r#"
directory=$1
offset=$2
limit=$3
allow_directory_symlink=$4

if [ ! -e "$directory" ] && [ ! -L "$directory" ]; then
  printf 'FM_NOT_FOUND:%s' "$directory" >&2
  exit 44
fi
if [ ! -d "$directory" ]; then
  printf 'FM_NOT_DIRECTORY:%s' "$directory" >&2
  exit 45
fi
if [ -L "$directory" ] && [ "$allow_directory_symlink" != 1 ]; then
  printf 'FM_UNSAFE_SYMLINK:%s' "$directory" >&2
  exit 47
fi
if ! cd -P "$directory" 2>/dev/null; then
  printf 'FM_PERMISSION_DENIED:%s' "$directory" >&2
  exit 46
fi

canonical=$PWD
readable=0
writable=0
[ -r . ] && readable=1
[ -w . ] && writable=1
if [ "$readable" -ne 1 ]; then
  printf 'FM_PERMISSION_DENIED:%s' "$canonical" >&2
  exit 46
fi

printf 'H\000%s\000%s\000%s\000' "$canonical" "$readable" "$writable"
index=0
emitted=0

# Do not use a shell glob here. The shell expands a glob before the loop
# starts, so a directory with many entries can exceed argv limits or spend the
# whole command timeout before the first page is emitted. find streams one
# NUL-delimited path at a time and the group keeps the pagination counters in
# the same shell process. NUL framing preserves spaces, newlines, quotes, and
# Unicode in names.
#
# The group exits with 99 when it intentionally stops after a full page. With
# pipefail enabled, that distinguishes the expected SIGPIPE from a real find
# failure, so a broken enumeration cannot be returned as an empty directory.
set -o pipefail
find . -mindepth 1 -maxdepth 1 -print0 2>/dev/null | {
  has_more=0
  while IFS= read -r -d "" item; do
    name=${item#./}
    if [ "$index" -lt "$offset" ]; then
      index=$((index + 1))
      continue
    fi
    if [ "$emitted" -ge "$limit" ]; then
      has_more=1
      break
    fi

    if [ -L "$item" ]; then
      kind=symlink
    elif [ -d "$item" ]; then
      kind=directory
    elif [ -f "$item" ]; then
      kind=file
    else
      kind=other
    fi

    size=$(stat -c %s "$item" 2>/dev/null || true)
    modified=$(stat -c %Y "$item" 2>/dev/null || true)
    mode=$(stat -c %A "$item" 2>/dev/null || true)
    item_readable=0
    item_writable=0
    [ -r "$item" ] && item_readable=1
    [ -w "$item" ] && item_writable=1
    printf 'E\000%s\000%s\000%s\000%s\000%s\000%s\000%s\000' \
      "$name" "$kind" "$size" "$modified" "$mode" "$item_readable" "$item_writable"
    if [ "$kind" = symlink ]; then
      readlink -n "$item" 2>/dev/null || true
    fi
    printf '\000'
    emitted=$((emitted + 1))
    index=$((index + 1))
  done
  printf 'M\000%s\000' "$has_more"
  if [ "$has_more" -eq 1 ]; then
    exit 99
  fi
}
pipeline_status=$?
if [ "$pipeline_status" -ne 0 ] && [ "$pipeline_status" -ne 99 ]; then
  printf 'FM_LIST_FAILED:%s' "$canonical" >&2
  exit 77
fi
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceFileKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFileEntry {
    name: String,
    path: String,
    kind: DeviceFileKind,
    size_bytes: Option<u64>,
    modified_epoch_seconds: Option<i64>,
    mode: Option<String>,
    readable: bool,
    writable: bool,
    hidden: bool,
    symlink_target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDirectoryListing {
    path: String,
    readable: bool,
    writable: bool,
    entries: Vec<DeviceFileEntry>,
    has_more: bool,
    offset: usize,
    next_offset: usize,
    limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerCommandError {
    code: String,
    message: String,
    path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileAccessMode {
    Shell,
    Root,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePathCapability {
    path: String,
    exists: bool,
    readable: bool,
    writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerCapabilities {
    effective_uid: String,
    access_mode: FileAccessMode,
    build_type: String,
    debuggable: bool,
    android_user_id: String,
    android_user_known: bool,
    android_user_state: String,
    locations: Vec<DevicePathCapability>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileTransferStatus {
    Success,
    Conflict,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum TransferItemKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferResult {
    source: String,
    destination: String,
    status: FileTransferStatus,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_kind: Option<TransferItemKind>,
}

impl FileTransferResult {
    fn new(
        source: impl Into<String>,
        destination: impl Into<String>,
        status: FileTransferStatus,
        message: impl Into<String>,
    ) -> Self {
        Self {
            source: source.into(),
            destination: destination.into(),
            status,
            message: message.into(),
            code: None,
            item_kind: None,
        }
    }

    fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    fn with_item_kind(mut self, item_kind: TransferItemKind) -> Self {
        self.item_kind = Some(item_kind);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HostFileIdentity {
    volume_or_device: u64,
    file_index: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HostDestinationSnapshot {
    kind: TransferItemKind,
    identity: HostFileIdentity,
}

impl TransferItemKind {
    fn as_remote_arg(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HostSourcePlan {
    kind: TransferItemKind,
    items: usize,
    total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedRemoteFile {
    remote_path: String,
    relative_host_path: PathBuf,
    ancestor_directories: Vec<String>,
    size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemotePullPlan {
    kind: TransferItemKind,
    directories: Vec<PathBuf>,
    files: Vec<PlannedRemoteFile>,
    total_bytes: u64,
}

trait FileTransferRunner {
    fn run(
        &self,
        args: &[&str],
        serial: &str,
        timeout: Duration,
    ) -> Result<Output, FileManagerCommandError>;
}

struct AppFileTransferRunner<'a> {
    app: &'a AppHandle,
    cancellation: Option<Arc<AtomicBool>>,
}

impl<'a> AppFileTransferRunner<'a> {
    fn new(app: &'a AppHandle) -> Self {
        Self {
            app,
            cancellation: None,
        }
    }

    fn with_cancellation(mut self, cancellation: Option<Arc<AtomicBool>>) -> Self {
        self.cancellation = cancellation;
        self
    }
}

impl FileTransferRunner for AppFileTransferRunner<'_> {
    fn run(
        &self,
        args: &[&str],
        serial: &str,
        timeout: Duration,
    ) -> Result<Output, FileManagerCommandError> {
        adb::run_adb_with_timeout_cancelable(
            self.app,
            args,
            Some(serial),
            timeout,
            self.cancellation.as_deref(),
        )
        .map_err(|error| map_adb_error(error, None))
    }
}

const FILE_TRANSFER_PROGRESS_EVENT: &str = "file-manager-transfer-progress";

static ACTIVE_FILE_TRANSFERS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn active_file_transfers() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_FILE_TRANSFERS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum TransferOperation {
    Push,
    Pull,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TransferPhase {
    Preparing,
    Transferring,
    ItemProcessed,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileTransferProgress {
    transfer_id: String,
    operation: TransferOperation,
    phase: TransferPhase,
    current_index: usize,
    total_items: usize,
    processed_items: usize,
    current_source: Option<String>,
    current_destination: Option<String>,
    elapsed_ms: u64,
    message: String,
}

struct TransferProgressReporter {
    app: AppHandle,
    transfer_id: Option<String>,
    operation: TransferOperation,
    total_items: usize,
    started_at: Instant,
    cancellation: Option<Arc<AtomicBool>>,
    processed_items: AtomicUsize,
}

impl TransferProgressReporter {
    fn new(
        app: AppHandle,
        transfer_id: Option<String>,
        operation: TransferOperation,
        total_items: usize,
    ) -> Self {
        let cancellation = transfer_id.as_ref().map(|id| {
            let flag = Arc::new(AtomicBool::new(false));
            if let Ok(mut active) = active_file_transfers().lock() {
                active.insert(id.clone(), flag.clone());
            }
            flag
        });
        let reporter = Self {
            app,
            transfer_id,
            operation,
            total_items,
            started_at: Instant::now(),
            cancellation,
            processed_items: AtomicUsize::new(0),
        };
        reporter.emit(
            TransferPhase::Preparing,
            0,
            0,
            None,
            None,
            "Preparing transfer",
        );
        reporter
    }

    fn cancellation(&self) -> Option<Arc<AtomicBool>> {
        self.cancellation.clone()
    }

    fn is_cancelled(&self) -> bool {
        self.cancellation
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Relaxed))
    }

    fn processed_items(&self) -> usize {
        self.processed_items.load(Ordering::Relaxed)
    }

    fn emit(
        &self,
        phase: TransferPhase,
        current_index: usize,
        processed_items: usize,
        current_source: Option<String>,
        current_destination: Option<String>,
        message: impl Into<String>,
    ) {
        let Some(transfer_id) = self.transfer_id.as_ref() else {
            return;
        };
        let _ = self.app.emit(
            FILE_TRANSFER_PROGRESS_EVENT,
            FileTransferProgress {
                transfer_id: transfer_id.clone(),
                operation: self.operation,
                phase,
                current_index,
                total_items: self.total_items,
                processed_items,
                current_source,
                current_destination,
                elapsed_ms: self.started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
                message: message.into(),
            },
        );
    }

    fn item_started(&self, index: usize, source: &str, destination: &str) {
        self.emit(
            TransferPhase::Transferring,
            index,
            index.saturating_sub(1),
            Some(source.to_string()),
            Some(destination.to_string()),
            "Transferring current item",
        );
    }

    fn item_processed(&self, index: usize, source: &str, destination: &str) {
        self.processed_items.store(index, Ordering::Relaxed);
        self.emit(
            TransferPhase::ItemProcessed,
            index,
            index,
            Some(source.to_string()),
            Some(destination.to_string()),
            "Finished current item",
        );
    }

    fn completed(&self) {
        let processed_items = self.processed_items();
        self.emit(
            TransferPhase::Completed,
            self.total_items,
            processed_items,
            None,
            None,
            "Transfer completed",
        );
    }

    fn cancelled(&self) {
        let processed_items = self.processed_items();
        self.emit(
            TransferPhase::Cancelled,
            processed_items,
            processed_items,
            None,
            None,
            "Transfer cancelled",
        );
    }
}

impl Drop for TransferProgressReporter {
    fn drop(&mut self) {
        if let Some(transfer_id) = self.transfer_id.as_ref() {
            if let Ok(mut active) = active_file_transfers().lock() {
                active.remove(transfer_id);
            }
        }
    }
}

struct TransferItemProgressGuard<'a> {
    reporter: &'a TransferProgressReporter,
    index: usize,
    source: String,
    destination: String,
}

impl Drop for TransferItemProgressGuard<'_> {
    fn drop(&mut self) {
        if !self.reporter.is_cancelled() {
            self.reporter
                .item_processed(self.index, &self.source, &self.destination);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferBatch {
    results: Vec<FileTransferResult>,
    succeeded: usize,
    conflicts: usize,
    failed: usize,
}

impl FileTransferBatch {
    fn from_results(results: Vec<FileTransferResult>) -> Self {
        let succeeded = results
            .iter()
            .filter(|result| result.status == FileTransferStatus::Success)
            .count();
        let conflicts = results
            .iter()
            .filter(|result| result.status == FileTransferStatus::Conflict)
            .count();
        let failed = results
            .iter()
            .filter(|result| result.status == FileTransferStatus::Failed)
            .count();
        Self {
            results,
            succeeded,
            conflicts,
            failed,
        }
    }
}

async fn spawn_file_manager_task<T, F>(
    operation: &'static str,
    task: F,
) -> Result<T, FileManagerCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, FileManagerCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            file_error(
                "task-failed",
                format!("File manager {operation} task failed: {error}"),
                None,
            )
        })?
}

#[tauri::command(async)]
pub async fn adb_file_capabilities(
    app: AppHandle,
    device_serial: String,
) -> Result<FileManagerCapabilities, FileManagerCommandError> {
    spawn_file_manager_task("capabilities", move || {
        adb_file_capabilities_blocking(app, device_serial)
    })
    .await
}

fn adb_file_capabilities_blocking(
    app: AppHandle,
    device_serial: String,
) -> Result<FileManagerCapabilities, FileManagerCommandError> {
    let serial = require_device_serial(&device_serial)?;
    let runner = AppFileTransferRunner::new(&app);
    let output = run_remote_script(
        &runner,
        serial,
        CAPABILITY_SCRIPT,
        CAPABILITY_PATHS,
        CAPABILITY_TIMEOUT,
    )?;
    if !output.status.success() {
        return Err(map_command_output_error(&output, None));
    }
    parse_capabilities_payload(&output.stdout)
        .map_err(|message| file_error("protocol-error", message, None))
}

#[tauri::command(async)]
pub async fn adb_file_cancel_transfer(
    transfer_id: String,
) -> Result<bool, FileManagerCommandError> {
    if transfer_id.trim().is_empty() {
        return Ok(false);
    }
    let active = active_file_transfers().lock().map_err(|_| {
        file_error(
            "transfer-state-error",
            "The file transfer state is unavailable",
            None,
        )
    })?;
    if let Some(cancellation) = active.get(&transfer_id) {
        cancellation.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command(async)]
pub async fn adb_file_push(
    app: AppHandle,
    device_serial: String,
    local_paths: Vec<String>,
    remote_directory: String,
    overwrite: bool,
    transfer_id: Option<String>,
) -> Result<FileTransferBatch, FileManagerCommandError> {
    spawn_file_manager_task("push", move || {
        adb_file_push_blocking(
            app,
            device_serial,
            local_paths,
            remote_directory,
            overwrite,
            transfer_id,
        )
    })
    .await
}

fn adb_file_push_blocking(
    app: AppHandle,
    device_serial: String,
    local_paths: Vec<String>,
    remote_directory: String,
    overwrite: bool,
    transfer_id: Option<String>,
) -> Result<FileTransferBatch, FileManagerCommandError> {
    let serial = require_device_serial(&device_serial)?;
    let remote_directory = normalize_remote_path(&remote_directory)
        .map_err(|message| file_error("invalid-path", message, Some(remote_directory.clone())))?;
    if local_paths.is_empty() {
        return Err(file_error(
            "empty-selection",
            "Choose at least one host file or folder",
            Some(remote_directory),
        ));
    }
    let reporter = TransferProgressReporter::new(
        app.clone(),
        transfer_id,
        TransferOperation::Push,
        local_paths.len(),
    );
    let runner = AppFileTransferRunner::new(&app).with_cancellation(reporter.cancellation());
    let cleanup_runner = AppFileTransferRunner::new(&app);
    let remote_directory = ensure_remote_directory(&runner, serial, &remote_directory)?;

    let mut results = Vec::with_capacity(local_paths.len());
    let mut batch_destinations = HashMap::<String, String>::new();
    for (index, source) in local_paths.into_iter().enumerate() {
        if reporter.is_cancelled() {
            break;
        }
        let local_path = PathBuf::from(&source);
        let progress_destination = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| join_remote_child(&remote_directory, name))
            .unwrap_or_else(|| remote_directory.clone());
        let _progress = TransferItemProgressGuard {
            reporter: &reporter,
            index: index + 1,
            source: source.clone(),
            destination: progress_destination.clone(),
        };
        reporter.item_started(index + 1, &source, &progress_destination);
        if !local_path.is_absolute() {
            results.push(
                FileTransferResult::new(
                    &source,
                    &remote_directory,
                    FileTransferStatus::Failed,
                    "The host source path must be absolute",
                )
                .with_code("invalid-path"),
            );
            continue;
        }
        let source_plan = match plan_host_source(&local_path) {
            Ok(plan) => plan,
            Err(error) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        &remote_directory,
                        FileTransferStatus::Failed,
                        error.message,
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        if source_plan.items == 0 {
            results.push(
                FileTransferResult::new(
                    &source,
                    &remote_directory,
                    FileTransferStatus::Failed,
                    "The host source produced an empty transfer plan",
                )
                .with_code("invalid-source"),
            );
            continue;
        }
        let Some(name) = local_path.file_name().and_then(|name| name.to_str()) else {
            results.push(
                FileTransferResult::new(
                    &source,
                    &remote_directory,
                    FileTransferStatus::Failed,
                    "The host source name is not valid UTF-8",
                )
                .with_code("invalid-path"),
            );
            continue;
        };
        if name.is_empty() {
            results.push(
                FileTransferResult::new(
                    &source,
                    &remote_directory,
                    FileTransferStatus::Failed,
                    "The host source has no file name",
                )
                .with_code("invalid-path"),
            );
            continue;
        }

        let destination = join_remote_child(&remote_directory, name);
        if let Some(previous) = batch_destinations.insert(destination.clone(), source.clone()) {
            results.push(
                FileTransferResult::new(
                    &source,
                    &destination,
                    FileTransferStatus::Failed,
                    format!("This host item has the same device destination as {previous:?}"),
                )
                .with_code("name-collision"),
            );
            continue;
        }
        let destination_kind = match probe_remote_path_kind(&runner, serial, &destination) {
            Ok(kind) => kind,
            Err(error) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        &destination,
                        FileTransferStatus::Failed,
                        error.message,
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        if destination_kind != ProbedRemoteKind::Missing && !overwrite {
            let result = FileTransferResult::new(
                &source,
                &destination,
                FileTransferStatus::Conflict,
                "A device item with this name already exists",
            )
            .with_code("conflict");
            let result = if source_plan.kind == TransferItemKind::Directory
                && destination_kind == ProbedRemoteKind::Directory
            {
                result.with_item_kind(TransferItemKind::Directory)
            } else {
                result
            };
            results.push(result);
            continue;
        }
        if let Err(message) = validate_type_matrix(source_plan.kind, destination_kind, overwrite) {
            results.push(
                FileTransferResult::new(&source, &destination, FileTransferStatus::Failed, message)
                    .with_code("type-mismatch"),
            );
            continue;
        }

        let Some(push_source) = local_path.to_str() else {
            results.push(
                FileTransferResult::new(
                    &source,
                    &destination,
                    FileTransferStatus::Failed,
                    "The host source path is not valid UTF-8",
                )
                .with_code("invalid-path"),
            );
            continue;
        };
        let stage = match allocate_remote_stage(&runner, serial, &remote_directory, "push") {
            Ok(stage) => stage,
            Err(error) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        &destination,
                        FileTransferStatus::Failed,
                        error.message,
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        let output = match runner.run(
            &["push", push_source, stage.as_str()],
            serial,
            FILE_TRANSFER_TIMEOUT,
        ) {
            Ok(output) => output,
            Err(error) => {
                cleanup_remote_stage(&cleanup_runner, serial, &stage);
                if reporter.is_cancelled() {
                    break;
                }
                results.push(
                    FileTransferResult::new(
                        &source,
                        &destination,
                        FileTransferStatus::Failed,
                        error.message,
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        if !output.status.success() {
            cleanup_remote_stage(&cleanup_runner, serial, &stage);
            results.push(
                FileTransferResult::new(
                    source,
                    destination,
                    FileTransferStatus::Failed,
                    transfer_output_message(&output),
                )
                .with_code(command_failure_code(&transfer_output_message(&output))),
            );
            continue;
        }

        let transfer_message = transfer_output_message(&output);
        let staged_plan = match plan_remote_source(&runner, serial, &stage) {
            Ok(plan) => plan,
            Err(error) => {
                cleanup_remote_stage(&cleanup_runner, serial, &stage);
                results.push(
                    FileTransferResult::new(
                        &source,
                        &destination,
                        FileTransferStatus::Failed,
                        format!("Device staging validation failed: {}", error.message),
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        let staged_items = staged_plan.directories.len() + staged_plan.files.len() + 1;
        if staged_plan.kind != source_plan.kind
            || staged_items != source_plan.items
            || staged_plan.total_bytes != source_plan.total_bytes
            || plan_host_source(&local_path).as_ref() != Ok(&source_plan)
        {
            cleanup_remote_stage(&cleanup_runner, serial, &stage);
            results.push(
                FileTransferResult::new(
                    &source,
                    &destination,
                    FileTransferStatus::Failed,
                    "The host source or staged device tree changed during transfer",
                )
                .with_code("source-changed"),
            );
            continue;
        }
        match commit_remote_stage(
            &runner,
            serial,
            &stage,
            &destination,
            &staged_plan,
            destination_kind,
            overwrite,
        ) {
            Ok(commit_message) => results.push(FileTransferResult::new(
                source,
                destination,
                FileTransferStatus::Success,
                join_transfer_messages(&transfer_message, &commit_message),
            )),
            Err(mut error) => {
                if commit_error_requires_preserved_staging(&error.code) {
                    error.message = format!(
                        "{}; the device staging path was preserved because commit state is uncertain: {}",
                        error.message, stage
                    );
                } else {
                    cleanup_remote_stage(&cleanup_runner, serial, &stage);
                }
                let status = if error.code == "conflict" {
                    FileTransferStatus::Conflict
                } else {
                    FileTransferStatus::Failed
                };
                results.push(
                    FileTransferResult::new(source, destination, status, error.message)
                        .with_code(error.code),
                );
            }
        }
    }

    if reporter.is_cancelled() {
        reporter.cancelled();
    } else {
        reporter.completed();
    }
    Ok(FileTransferBatch::from_results(results))
}

#[tauri::command(async)]
pub async fn adb_file_pull(
    app: AppHandle,
    device_serial: String,
    remote_paths: Vec<String>,
    local_directory: String,
    overwrite: bool,
    transfer_id: Option<String>,
) -> Result<FileTransferBatch, FileManagerCommandError> {
    spawn_file_manager_task("pull", move || {
        adb_file_pull_blocking(
            app,
            device_serial,
            remote_paths,
            local_directory,
            overwrite,
            transfer_id,
        )
    })
    .await
}

fn adb_file_pull_blocking(
    app: AppHandle,
    device_serial: String,
    remote_paths: Vec<String>,
    local_directory: String,
    overwrite: bool,
    transfer_id: Option<String>,
) -> Result<FileTransferBatch, FileManagerCommandError> {
    let serial = require_device_serial(&device_serial)?;
    let local_directory_path = PathBuf::from(&local_directory);
    if !local_directory_path.is_absolute() || !local_directory_path.is_dir() {
        return Err(file_error(
            "invalid-local-directory",
            "Choose an existing absolute host destination folder",
            Some(local_directory),
        ));
    }
    if remote_paths.is_empty() {
        return Err(file_error(
            "empty-selection",
            "Select at least one device file or folder",
            None,
        ));
    }

    reject_unsafe_host_metadata(&local_directory_path, "host destination directory")?;
    let reporter = TransferProgressReporter::new(
        app.clone(),
        transfer_id,
        TransferOperation::Pull,
        remote_paths.len(),
    );
    let runner = AppFileTransferRunner::new(&app).with_cancellation(reporter.cancellation());
    let results = pull_remote_paths_with_progress(
        &runner,
        serial,
        remote_paths,
        &local_directory_path,
        overwrite,
        Some(&reporter),
        0,
    );
    if reporter.is_cancelled() {
        reporter.cancelled();
    } else {
        reporter.completed();
    }
    Ok(FileTransferBatch::from_results(results))
}

#[tauri::command(async)]
pub async fn adb_file_list(
    app: AppHandle,
    device_serial: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<DeviceDirectoryListing, FileManagerCommandError> {
    spawn_file_manager_task("list", move || {
        adb_file_list_blocking(app, device_serial, path, offset, limit)
    })
    .await
}

fn adb_file_list_blocking(
    app: AppHandle,
    device_serial: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<DeviceDirectoryListing, FileManagerCommandError> {
    let serial = require_device_serial(&device_serial)?;
    let normalized_path = normalize_remote_path(&path)
        .map_err(|message| file_error("invalid-path", message, Some(path.clone())))?;
    let offset = offset.unwrap_or(0);
    let limit = limit
        .unwrap_or(DEFAULT_DIRECTORY_PAGE_SIZE)
        .clamp(1, MAX_DIRECTORY_PAGE_SIZE);
    let offset_arg = offset.to_string();
    let limit_arg = limit.to_string();
    let runner = AppFileTransferRunner::new(&app);
    let output = run_remote_script(
        &runner,
        serial,
        DIRECTORY_LIST_SCRIPT,
        &[
            normalized_path.as_str(),
            offset_arg.as_str(),
            limit_arg.as_str(),
            "1",
        ],
        DIRECTORY_LIST_TIMEOUT,
    )
    .map_err(|mut error| {
        if error.path.is_none() {
            error.path = Some(normalized_path.clone());
        }
        error
    })?;

    if !output.status.success() {
        return Err(map_command_output_error(
            &output,
            Some(normalized_path.clone()),
        ));
    }

    let mut listing = parse_listing_payload(&output.stdout)
        .map_err(|message| file_error("protocol-error", message, Some(normalized_path)))?;
    listing.offset = offset;
    listing.limit = limit;
    listing.next_offset = offset.saturating_add(listing.entries.len());
    Ok(listing)
}

fn normalize_remote_path(path: &str) -> Result<String, String> {
    if path.is_empty() || !path.starts_with('/') {
        return Err("Device path must be absolute".to_string());
    }
    if path.contains('\0') {
        return Err("Device path contains a NUL byte".to_string());
    }

    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err("Device path crosses the filesystem root".to_string());
                }
            }
            value => segments.push(value),
        }
    }

    Ok(if segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", segments.join("/"))
    })
}

fn remote_basename(path: &str) -> Result<String, String> {
    let normalized = normalize_remote_path(path)?;
    if normalized == "/" {
        return Err("The device filesystem root cannot be copied as one item".to_string());
    }
    normalized
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Device path has no copyable item name".to_string())
}

fn join_remote_child(parent: &str, child: &str) -> String {
    if parent == "/" {
        format!("/{child}")
    } else {
        format!("{}/{child}", parent.trim_end_matches('/'))
    }
}

fn sanitize_windows_file_name(name: &str) -> String {
    const MAX_COMPONENT_UTF16_UNITS: usize = 180;
    let mut sanitized = String::new();
    let mut utf16_units = 0usize;
    for character in name.chars() {
        let character = if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) {
            '_'
        } else {
            character
        };
        let character_units = character.len_utf16();
        if utf16_units + character_units > MAX_COMPONENT_UTF16_UNITS {
            break;
        }
        utf16_units += character_units;
        sanitized.push(character);
    }
    sanitized = sanitized.trim_end_matches([' ', '.']).to_string();
    if sanitized.is_empty() {
        sanitized.push('_');
    }

    let stem = sanitized
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").is_some_and(|number| {
            matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || stem.strip_prefix("LPT").is_some_and(|number| {
            matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if reserved {
        sanitized.insert(0, '_');
    }
    sanitized
}

fn remote_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn build_remote_shell_command(script: &str, args: &[&str]) -> String {
    let mut command = vec![
        "sh".to_string(),
        "-c".to_string(),
        remote_shell_quote(script),
        "adb-file-manager".to_string(),
    ];
    command.extend(args.iter().map(|argument| remote_shell_quote(argument)));
    command.join(" ")
}

fn parse_listing_payload(payload: &[u8]) -> Result<DeviceDirectoryListing, String> {
    let fields = payload.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut cursor = 0usize;

    if next_protocol_field(&fields, &mut cursor)? != b"H" {
        return Err("Directory listing is missing its header".to_string());
    }
    let path = parse_utf8_field(next_protocol_field(&fields, &mut cursor)?, "path")?;
    let readable = parse_bool_field(
        next_protocol_field(&fields, &mut cursor)?,
        "directory readable flag",
    )?;
    let writable = parse_bool_field(
        next_protocol_field(&fields, &mut cursor)?,
        "directory writable flag",
    )?;
    let mut entries = Vec::new();
    let mut has_more = None;

    loop {
        let tag = next_protocol_field(&fields, &mut cursor)?;
        if tag.is_empty() && cursor == fields.len() {
            break;
        }
        match tag {
            b"E" => {
                if has_more.is_some() {
                    return Err("Directory entry appears after listing metadata".to_string());
                }
                let name = parse_utf8_field(next_protocol_field(&fields, &mut cursor)?, "name")?;
                let kind = match next_protocol_field(&fields, &mut cursor)? {
                    b"file" => DeviceFileKind::File,
                    b"directory" => DeviceFileKind::Directory,
                    b"symlink" => DeviceFileKind::Symlink,
                    b"other" => DeviceFileKind::Other,
                    _ => return Err("Directory entry has an unknown kind".to_string()),
                };
                let size_bytes =
                    parse_optional_number(next_protocol_field(&fields, &mut cursor)?, "size")?;
                let modified_epoch_seconds = parse_optional_number(
                    next_protocol_field(&fields, &mut cursor)?,
                    "modified time",
                )?;
                let mode = optional_utf8_field(next_protocol_field(&fields, &mut cursor)?, "mode")?;
                let entry_readable = parse_bool_field(
                    next_protocol_field(&fields, &mut cursor)?,
                    "entry readable flag",
                )?;
                let entry_writable = parse_bool_field(
                    next_protocol_field(&fields, &mut cursor)?,
                    "entry writable flag",
                )?;
                let symlink_target = optional_utf8_field(
                    next_protocol_field(&fields, &mut cursor)?,
                    "symlink target",
                )?;
                let entry_path = if path == "/" {
                    format!("/{name}")
                } else {
                    format!("{path}/{name}")
                };
                entries.push(DeviceFileEntry {
                    hidden: name.starts_with('.'),
                    name,
                    path: entry_path,
                    kind,
                    size_bytes,
                    modified_epoch_seconds,
                    mode,
                    readable: entry_readable,
                    writable: entry_writable,
                    symlink_target,
                });
            }
            b"M" => {
                if has_more.is_some() {
                    return Err("Directory listing contains duplicate metadata".to_string());
                }
                has_more = Some(parse_bool_field(
                    next_protocol_field(&fields, &mut cursor)?,
                    "has-more flag",
                )?);
            }
            _ => return Err("Directory listing contains an unknown record".to_string()),
        }
    }

    let has_more = has_more.ok_or_else(|| "Directory listing is missing metadata".to_string())?;
    Ok(DeviceDirectoryListing {
        path,
        readable,
        writable,
        entries,
        has_more,
        offset: 0,
        next_offset: 0,
        limit: 0,
    })
}

fn parse_capabilities_payload(payload: &[u8]) -> Result<FileManagerCapabilities, String> {
    let fields = payload.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut cursor = 0usize;
    if next_protocol_field(&fields, &mut cursor)? != b"C" {
        return Err("File capability response is missing its header".to_string());
    }

    let effective_uid =
        parse_utf8_field(next_protocol_field(&fields, &mut cursor)?, "effective UID")?;
    let build_type = parse_utf8_field(next_protocol_field(&fields, &mut cursor)?, "build type")?;
    let debuggable = parse_bool_field(
        next_protocol_field(&fields, &mut cursor)?,
        "debuggable flag",
    )?;
    let android_user_id = parse_utf8_field(
        next_protocol_field(&fields, &mut cursor)?,
        "Android user ID",
    )?;
    let android_user_known = parse_bool_field(
        next_protocol_field(&fields, &mut cursor)?,
        "Android user known flag",
    )?;
    let android_user_state = parse_utf8_field(
        next_protocol_field(&fields, &mut cursor)?,
        "Android user state",
    )?;
    let mut locations = Vec::new();

    loop {
        let tag = next_protocol_field(&fields, &mut cursor)?;
        if tag.is_empty() && cursor == fields.len() {
            break;
        }
        if tag != b"R" {
            return Err("File capability response contains an unknown record".to_string());
        }
        locations.push(DevicePathCapability {
            path: parse_utf8_field(next_protocol_field(&fields, &mut cursor)?, "root path")?,
            exists: parse_bool_field(
                next_protocol_field(&fields, &mut cursor)?,
                "root exists flag",
            )?,
            readable: parse_bool_field(
                next_protocol_field(&fields, &mut cursor)?,
                "root readable flag",
            )?,
            writable: parse_bool_field(
                next_protocol_field(&fields, &mut cursor)?,
                "root writable flag",
            )?,
        });
    }

    let access_mode = if effective_uid == "0" {
        FileAccessMode::Root
    } else {
        FileAccessMode::Shell
    };
    Ok(FileManagerCapabilities {
        effective_uid,
        access_mode,
        build_type,
        debuggable,
        android_user_id,
        android_user_known,
        android_user_state,
        locations,
    })
}

fn require_device_serial(device_serial: &str) -> Result<&str, FileManagerCommandError> {
    if device_serial.is_empty() {
        Err(file_error(
            "device-required",
            "Select an online device before using the file manager",
            None,
        ))
    } else {
        Ok(device_serial)
    }
}

fn file_error(
    code: impl Into<String>,
    message: impl Into<String>,
    path: Option<String>,
) -> FileManagerCommandError {
    FileManagerCommandError {
        code: code.into(),
        message: message.into(),
        path,
    }
}

fn map_adb_error(error: AdbError, path: Option<String>) -> FileManagerCommandError {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    let code = if matches!(error, AdbError::CommandCancelled) {
        "cancelled"
    } else if lower.contains("timed out") || lower.contains("超时") {
        "timeout"
    } else if is_adb_transport_failure(&lower) {
        "transport-error"
    } else {
        "adb-error"
    };
    file_error(code, message, path)
}

fn map_command_output_error(
    output: &std::process::Output,
    path: Option<String>,
) -> FileManagerCommandError {
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    file_error(command_failure_code(&detail), detail, path)
}

fn command_failure_code(detail: &str) -> &'static str {
    let lower = detail.to_ascii_lowercase();
    if detail.contains("FM_CONFLICT") {
        "conflict"
    } else if detail.contains("FM_ATOMIC_UNSUPPORTED") {
        "atomic-commit-unsupported"
    } else if detail.contains("FM_ROLLBACK_FAILED") {
        "commit-state-unknown"
    } else if detail.contains("FM_ATOMIC_COMMIT_FAILED") || detail.contains("FM_BACKUP_LEFT") {
        "atomic-commit-failed"
    } else if detail.contains("FM_SOURCE_CHANGED") || detail.contains("FM_STAGE_MISSING") {
        "source-changed"
    } else if detail.contains("FM_UNSAFE_SYMLINK") || detail.contains("FM_UNSAFE_STAGE") {
        "unsafe-symlink"
    } else if detail.contains("FM_TYPE_MISMATCH") {
        "type-mismatch"
    } else if detail.contains("FM_LIMIT_EXCEEDED") {
        "transfer-limit"
    } else if detail.contains("FM_PERMISSION_DENIED") {
        "permission-denied"
    } else if detail.contains("FM_NOT_FOUND") {
        "not-found"
    } else if detail.contains("FM_NOT_DIRECTORY") {
        "not-directory"
    } else if is_adb_transport_failure(&lower) {
        "transport-error"
    } else if lower.contains("permission denied") {
        "permission-denied"
    } else if lower.contains("no such file") {
        "not-found"
    } else if lower.contains("not a directory") {
        "not-directory"
    } else if lower.contains("read-only file system") {
        "read-only"
    } else if lower.contains("no space left") {
        "no-space"
    } else {
        "command-failed"
    }
}

fn is_adb_transport_failure(lower_detail: &str) -> bool {
    lower_detail.contains("offline")
        || lower_detail.contains("unauthorized")
        || lower_detail.contains("no devices/emulators found")
        || (lower_detail.contains("device '") && lower_detail.contains("' not found"))
        || (lower_detail.contains("device \"") && lower_detail.contains("\" not found"))
        || (lower_detail.contains("error: device ") && lower_detail.contains(" not found"))
}

fn parse_single_nul_terminated_utf8(
    payload: Vec<u8>,
    label: &str,
) -> Result<String, FileManagerCommandError> {
    let Some(value) = payload.strip_suffix(&[0]) else {
        return Err(file_error(
            "protocol-error",
            format!("{label} is missing its NUL terminator"),
            None,
        ));
    };
    if value.contains(&0) {
        return Err(file_error(
            "protocol-error",
            format!("{label} contains extra NUL-delimited fields"),
            None,
        ));
    }
    String::from_utf8(value.to_vec()).map_err(|_| {
        file_error(
            "protocol-error",
            format!("{label} contains non-UTF-8 data"),
            None,
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProbedRemoteKind {
    File,
    Directory,
    Symlink,
    Other,
    Missing,
}

fn ensure_remote_directory<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    remote_directory: &str,
) -> Result<String, FileManagerCommandError> {
    let output = run_remote_script(
        runner,
        serial,
        DIRECTORY_PROBE_SCRIPT,
        &[remote_directory],
        PATH_PROBE_TIMEOUT,
    )?;
    if !output.status.success() {
        return Err(map_command_output_error(
            &output,
            Some(remote_directory.to_string()),
        ));
    }
    let canonical = parse_single_nul_terminated_utf8(output.stdout, "Device directory probe")
        .map_err(|mut error| {
            error.path = Some(remote_directory.to_string());
            error
        })?;
    normalize_remote_path(&canonical).map_err(|message| {
        file_error(
            "protocol-error",
            format!("Device directory probe returned an invalid path: {message}"),
            Some(remote_directory.to_string()),
        )
    })
}

fn probe_remote_path_kind<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    remote_path: &str,
) -> Result<ProbedRemoteKind, FileManagerCommandError> {
    let output = run_remote_script(
        runner,
        serial,
        PATH_KIND_SCRIPT,
        &[remote_path],
        PATH_PROBE_TIMEOUT,
    )?;
    if !output.status.success() {
        return Err(map_command_output_error(
            &output,
            Some(remote_path.to_string()),
        ));
    }
    match output.stdout.as_slice() {
        b"file" => Ok(ProbedRemoteKind::File),
        b"directory" => Ok(ProbedRemoteKind::Directory),
        b"symlink" => Ok(ProbedRemoteKind::Symlink),
        b"other" => Ok(ProbedRemoteKind::Other),
        b"missing" => Ok(ProbedRemoteKind::Missing),
        _ => Err(file_error(
            "protocol-error",
            "Device path probe returned an unknown file kind",
            Some(remote_path.to_string()),
        )),
    }
}

fn remote_regular_file_size<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    remote_path: &str,
) -> Result<u64, FileManagerCommandError> {
    let output = run_remote_script(
        runner,
        serial,
        REGULAR_FILE_SIZE_SCRIPT,
        &[remote_path],
        PATH_PROBE_TIMEOUT,
    )?;
    if !output.status.success() {
        return Err(map_command_output_error(
            &output,
            Some(remote_path.to_string()),
        ));
    }
    std::str::from_utf8(&output.stdout)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| {
            file_error(
                "protocol-error",
                "Device file size probe returned invalid data",
                Some(remote_path.to_string()),
            )
        })
}

fn run_remote_script<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    script: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<Output, FileManagerCommandError> {
    let command = build_remote_shell_command(script, args);
    runner.run(&["shell", command.as_str()], serial, timeout)
}

#[cfg(target_os = "windows")]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(target_os = "windows"))]
fn metadata_is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn reject_unsafe_host_metadata(
    path: &Path,
    label: &str,
) -> Result<fs::Metadata, FileManagerCommandError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        file_error(
            "host-io-error",
            format!("Cannot inspect {label}: {error}"),
            Some(path.to_string_lossy().to_string()),
        )
    })?;
    if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
        return Err(file_error(
            "unsafe-symlink",
            format!("{label} is a symlink or reparse point"),
            Some(path.to_string_lossy().to_string()),
        ));
    }
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(file_error(
            "unsupported-file-type",
            format!("{label} is not a regular file or directory"),
            Some(path.to_string_lossy().to_string()),
        ));
    }
    Ok(metadata)
}

fn plan_host_source(path: &Path) -> Result<HostSourcePlan, FileManagerCommandError> {
    let root = reject_unsafe_host_metadata(path, "host source")?;
    if root.is_file() {
        let total_bytes = root.len();
        if total_bytes > MAX_TRANSFER_TOTAL_BYTES {
            return Err(transfer_limit_error(path, "total byte limit"));
        }
        return Ok(HostSourcePlan {
            kind: TransferItemKind::File,
            items: 1,
            total_bytes,
        });
    }

    let mut queue = VecDeque::from([(path.to_path_buf(), 0usize)]);
    let mut items = 1usize;
    let mut total_bytes = 0u64;
    while let Some((directory, depth)) = queue.pop_front() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            file_error(
                "host-io-error",
                format!("Cannot read host source directory: {error}"),
                Some(directory.to_string_lossy().to_string()),
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                file_error(
                    "host-io-error",
                    format!("Cannot read a host source entry: {error}"),
                    Some(directory.to_string_lossy().to_string()),
                )
            })?;
            if entry.file_name().to_str().is_none() {
                return Err(file_error(
                    "unsupported-name-encoding",
                    "A host source name is not valid UTF-8",
                    Some(entry.path().to_string_lossy().to_string()),
                ));
            }
            let entry_depth = depth.saturating_add(1);
            if entry_depth > MAX_TRANSFER_DEPTH {
                return Err(transfer_limit_error(&entry.path(), "directory depth limit"));
            }
            items = items
                .checked_add(1)
                .ok_or_else(|| transfer_limit_error(&entry.path(), "item count limit"))?;
            if items > MAX_TRANSFER_ITEMS {
                return Err(transfer_limit_error(&entry.path(), "item count limit"));
            }
            let metadata = reject_unsafe_host_metadata(&entry.path(), "host source entry")?;
            if metadata.is_dir() {
                queue.push_back((entry.path(), entry_depth));
            } else {
                total_bytes = total_bytes
                    .checked_add(metadata.len())
                    .ok_or_else(|| transfer_limit_error(&entry.path(), "total byte limit"))?;
                if total_bytes > MAX_TRANSFER_TOTAL_BYTES {
                    return Err(transfer_limit_error(&entry.path(), "total byte limit"));
                }
            }
        }
    }

    Ok(HostSourcePlan {
        kind: TransferItemKind::Directory,
        items,
        total_bytes,
    })
}

fn transfer_limit_error(path: &Path, limit: &str) -> FileManagerCommandError {
    file_error(
        "transfer-limit",
        format!("The transfer exceeds the configured {limit}"),
        Some(path.to_string_lossy().to_string()),
    )
}

fn validate_type_matrix(
    source_kind: TransferItemKind,
    destination_kind: ProbedRemoteKind,
    overwrite: bool,
) -> Result<(), String> {
    match destination_kind {
        ProbedRemoteKind::Missing => Ok(()),
        ProbedRemoteKind::Symlink => {
            Err("Refusing to replace a device symlink or reparse-like entry".to_string())
        }
        ProbedRemoteKind::Other => {
            Err("Refusing to replace a special device filesystem entry".to_string())
        }
        ProbedRemoteKind::File if source_kind != TransferItemKind::File => {
            Err("A directory cannot replace an existing device file".to_string())
        }
        ProbedRemoteKind::Directory if source_kind != TransferItemKind::Directory => {
            Err("A file cannot replace an existing device directory".to_string())
        }
        _ if !overwrite => Err("The device destination already exists".to_string()),
        _ => Ok(()),
    }
}

fn transfer_token() -> String {
    let mut random = [0u8; 16];
    let random_hex = fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut random))
        .ok()
        .map(|()| {
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        });
    random_hex.unwrap_or_else(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let counter = TRANSFER_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("{now:032x}-{:08x}-{counter:016x}", std::process::id())
    })
}

fn remote_stage_path(parent: &str, role: &str) -> String {
    join_remote_child(
        parent,
        &format!(".adb-manager-stage-{role}-{}", transfer_token()),
    )
}

fn allocate_remote_stage<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    parent: &str,
    role: &str,
) -> Result<String, FileManagerCommandError> {
    for _ in 0..8 {
        let candidate = remote_stage_path(parent, role);
        if probe_remote_path_kind(runner, serial, &candidate)? == ProbedRemoteKind::Missing {
            return Ok(candidate);
        }
    }
    Err(file_error(
        "staging-collision",
        "Cannot allocate a unique device staging path",
        Some(parent.to_string()),
    ))
}

fn cleanup_remote_stage<R: FileTransferRunner>(runner: &R, serial: &str, stage: &str) {
    let _ = run_remote_script(
        runner,
        serial,
        REMOTE_REMOVE_STAGE_SCRIPT,
        &[stage],
        FILE_TRANSFER_TIMEOUT,
    );
}

fn commit_error_requires_preserved_staging(code: &str) -> bool {
    matches!(code, "timeout" | "transport-error" | "commit-state-unknown")
}

fn remote_plans_have_same_shape(expected: &RemotePullPlan, actual: &RemotePullPlan) -> bool {
    if expected.kind != actual.kind || expected.total_bytes != actual.total_bytes {
        return false;
    }
    let mut expected_directories = expected.directories.clone();
    let mut actual_directories = actual.directories.clone();
    expected_directories.sort();
    actual_directories.sort();
    if expected_directories != actual_directories {
        return false;
    }
    let mut expected_files = expected
        .files
        .iter()
        .map(|file| (file.relative_host_path.clone(), file.size_bytes))
        .collect::<Vec<_>>();
    let mut actual_files = actual
        .files
        .iter()
        .map(|file| (file.relative_host_path.clone(), file.size_bytes))
        .collect::<Vec<_>>();
    expected_files.sort();
    actual_files.sort();
    expected_files == actual_files
}

fn commit_remote_stage<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    stage: &str,
    destination: &str,
    expected_plan: &RemotePullPlan,
    destination_kind: ProbedRemoteKind,
    overwrite: bool,
) -> Result<String, FileManagerCommandError> {
    let source_kind = expected_plan.kind;
    validate_type_matrix(source_kind, destination_kind, overwrite)
        .map_err(|message| file_error("type-mismatch", message, Some(destination.to_string())))?;
    let output = if overwrite && destination_kind != ProbedRemoteKind::Missing {
        run_remote_script(
            runner,
            serial,
            REMOTE_COMMIT_REPLACE_SCRIPT,
            &[stage, destination, source_kind.as_remote_arg()],
            FILE_TRANSFER_TIMEOUT,
        )?
    } else {
        run_remote_script(
            runner,
            serial,
            REMOTE_COMMIT_NO_CLOBBER_SCRIPT,
            &[stage, destination, source_kind.as_remote_arg()],
            FILE_TRANSFER_TIMEOUT,
        )?
    };
    if !output.status.success() {
        return Err(map_command_output_error(
            &output,
            Some(destination.to_string()),
        ));
    }
    if !output.stderr.is_empty() || output.stdout.starts_with(b"FM_") {
        let detail = if output.stderr.is_empty() {
            String::from_utf8_lossy(&output.stdout).into_owned()
        } else {
            String::from_utf8_lossy(&output.stderr).into_owned()
        };
        return Err(file_error(
            command_failure_code(&detail),
            detail,
            Some(destination.to_string()),
        ));
    }
    let commit_mode = match output.stdout.as_slice() {
        b"ok:exchange" => "atomic exchange",
        b"ok:fallback" => "verified non-atomic fallback",
        _ => {
            return Err(file_error(
                "protocol-error",
                "Device commit returned an invalid success marker",
                Some(destination.to_string()),
            ));
        }
    };

    let final_kind = probe_remote_path_kind(runner, serial, destination)?;
    let stage_kind = probe_remote_path_kind(runner, serial, stage)?;
    let expected_kind = match source_kind {
        TransferItemKind::File => ProbedRemoteKind::File,
        TransferItemKind::Directory => ProbedRemoteKind::Directory,
    };
    if final_kind != expected_kind || stage_kind != ProbedRemoteKind::Missing {
        return Err(file_error(
            "atomic-commit-failed",
            format!(
                "Device commit postcondition failed: final={final_kind:?}, stage={stage_kind:?}"
            ),
            Some(destination.to_string()),
        ));
    }
    let backup = format!("{stage}.backup");
    let backup_kind = probe_remote_path_kind(runner, serial, &backup)?;
    if backup_kind != ProbedRemoteKind::Missing {
        return Err(file_error(
            "atomic-commit-failed",
            format!("Device commit left a recovery backup behind: backup={backup_kind:?}"),
            Some(destination.to_string()),
        ));
    }
    let committed_plan = plan_remote_source(runner, serial, destination).map_err(|error| {
        if error.code == "transport-error" || error.code == "timeout" {
            error
        } else {
            file_error(
                "atomic-commit-failed",
                format!("Cannot verify the committed device tree: {}", error.message),
                Some(destination.to_string()),
            )
        }
    })?;
    if !remote_plans_have_same_shape(expected_plan, &committed_plan) {
        return Err(file_error(
            "source-changed",
            "The committed device tree does not match the validated staging tree",
            Some(destination.to_string()),
        ));
    }
    Ok(format!(
        "Committed from same-parent staging via {commit_mode}"
    ))
}

fn join_transfer_messages(transfer: &str, commit: &str) -> String {
    if transfer.is_empty() {
        commit.to_string()
    } else if commit.is_empty() {
        transfer.to_string()
    } else {
        format!("{transfer}; {commit}")
    }
}

fn safe_host_component_for(name: &str, windows: bool) -> Result<String, String> {
    if name.is_empty() || matches!(name, "." | "..") || name.contains('/') || name.contains('\0') {
        return Err("Device entry has an unsafe host path component".to_string());
    }
    let safe = if windows {
        sanitize_windows_file_name(name)
    } else {
        name.to_string()
    };
    if safe.is_empty() || matches!(safe.as_str(), "." | "..") {
        Err("Device entry maps to an unsafe host path component".to_string())
    } else {
        Ok(safe)
    }
}

fn host_collision_key(name: &str, windows: bool) -> String {
    if windows {
        name.to_lowercase()
    } else {
        name.to_string()
    }
}

fn list_remote_directory_all<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    remote_directory: &str,
) -> Result<(String, Vec<DeviceFileEntry>), FileManagerCommandError> {
    let mut offset = 0usize;
    let mut canonical = None::<String>;
    let mut entries = Vec::new();
    loop {
        let offset_arg = offset.to_string();
        let limit_arg = REMOTE_PLAN_PAGE_SIZE.to_string();
        let output = run_remote_script(
            runner,
            serial,
            DIRECTORY_LIST_SCRIPT,
            &[
                remote_directory,
                offset_arg.as_str(),
                limit_arg.as_str(),
                "0",
            ],
            DIRECTORY_LIST_TIMEOUT,
        )?;
        if !output.status.success() {
            return Err(map_command_output_error(
                &output,
                Some(remote_directory.to_string()),
            ));
        }
        let listing = parse_listing_payload(&output.stdout).map_err(|message| {
            file_error(
                "protocol-error",
                message,
                Some(remote_directory.to_string()),
            )
        })?;
        let listing_path = normalize_remote_path(&listing.path).map_err(|message| {
            file_error(
                "protocol-error",
                format!("Device listing returned an invalid canonical path: {message}"),
                Some(remote_directory.to_string()),
            )
        })?;
        if let Some(previous) = canonical.as_ref() {
            if previous != &listing_path {
                return Err(file_error(
                    "source-changed",
                    "Device directory identity changed while it was being planned",
                    Some(remote_directory.to_string()),
                ));
            }
        } else {
            canonical = Some(listing_path);
        }
        let page_len = listing.entries.len();
        entries.extend(listing.entries);
        if !listing.has_more {
            break;
        }
        if page_len == 0 {
            return Err(file_error(
                "protocol-error",
                "Device listing reported more entries without making progress",
                Some(remote_directory.to_string()),
            ));
        }
        offset = offset.checked_add(page_len).ok_or_else(|| {
            file_error(
                "transfer-limit",
                "Device listing offset overflowed",
                Some(remote_directory.to_string()),
            )
        })?;
        if offset > MAX_TRANSFER_ITEMS {
            return Err(file_error(
                "transfer-limit",
                "The device directory exceeds the item count limit",
                Some(remote_directory.to_string()),
            ));
        }
    }
    Ok((
        canonical.unwrap_or_else(|| remote_directory.to_string()),
        entries,
    ))
}

fn plan_remote_source<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    remote_source: &str,
) -> Result<RemotePullPlan, FileManagerCommandError> {
    match probe_remote_path_kind(runner, serial, remote_source)? {
        ProbedRemoteKind::Missing => {
            return Err(file_error(
                "not-found",
                "The device source no longer exists",
                Some(remote_source.to_string()),
            ));
        }
        ProbedRemoteKind::Symlink => {
            return Err(file_error(
                "unsafe-symlink",
                "Device symlinks cannot be copied to the host",
                Some(remote_source.to_string()),
            ));
        }
        ProbedRemoteKind::Other => {
            return Err(file_error(
                "unsupported-file-type",
                "Special device filesystem entries cannot be copied",
                Some(remote_source.to_string()),
            ));
        }
        ProbedRemoteKind::File => {
            let size_bytes = remote_regular_file_size(runner, serial, remote_source)?;
            if size_bytes > MAX_TRANSFER_TOTAL_BYTES {
                return Err(file_error(
                    "transfer-limit",
                    "The device file exceeds the total byte limit",
                    Some(remote_source.to_string()),
                ));
            }
            return Ok(RemotePullPlan {
                kind: TransferItemKind::File,
                directories: Vec::new(),
                files: vec![PlannedRemoteFile {
                    remote_path: remote_source.to_string(),
                    relative_host_path: PathBuf::new(),
                    ancestor_directories: Vec::new(),
                    size_bytes,
                }],
                total_bytes: size_bytes,
            });
        }
        ProbedRemoteKind::Directory => {}
    }

    let mut queue = VecDeque::from([(
        remote_source.to_string(),
        PathBuf::new(),
        Vec::<String>::new(),
        0usize,
    )]);
    let mut directories = Vec::new();
    let mut files = Vec::new();
    let mut items = 1usize;
    let mut total_bytes = 0u64;
    while let Some((remote_directory, relative_directory, ancestor_directories, depth)) =
        queue.pop_front()
    {
        if probe_remote_path_kind(runner, serial, &remote_directory)? != ProbedRemoteKind::Directory
        {
            return Err(file_error(
                "source-changed",
                "A device directory changed type while it was being planned",
                Some(remote_directory),
            ));
        }
        let (canonical_directory, entries) =
            list_remote_directory_all(runner, serial, &remote_directory)?;
        if depth > 0 && canonical_directory != remote_directory {
            return Err(file_error(
                "source-changed",
                "A device directory resolved outside its planned canonical path",
                Some(remote_directory),
            ));
        }
        let mut current_ancestors = ancestor_directories;
        if current_ancestors.is_empty() {
            current_ancestors.push(canonical_directory.clone());
        }
        let mut sibling_names = HashMap::<String, String>::new();
        for entry in entries {
            let safe_name = safe_host_component_for(&entry.name, cfg!(target_os = "windows"))
                .map_err(|message| file_error("unsafe-name", message, Some(entry.path.clone())))?;
            let collision_key = host_collision_key(&safe_name, cfg!(target_os = "windows"));
            if let Some(previous) = sibling_names.insert(collision_key, entry.name.clone()) {
                return Err(file_error(
                    "name-collision",
                    format!(
                        "Device names {previous:?} and {:?} map to the same host name",
                        entry.name
                    ),
                    Some(canonical_directory.clone()),
                ));
            }
            let entry_depth = depth.saturating_add(1);
            if entry_depth > MAX_TRANSFER_DEPTH {
                return Err(file_error(
                    "transfer-limit",
                    "The device directory exceeds the depth limit",
                    Some(entry.path),
                ));
            }
            items = items.checked_add(1).ok_or_else(|| {
                file_error(
                    "transfer-limit",
                    "The device directory exceeds the item count limit",
                    Some(entry.path.clone()),
                )
            })?;
            if items > MAX_TRANSFER_ITEMS {
                return Err(file_error(
                    "transfer-limit",
                    "The device directory exceeds the item count limit",
                    Some(entry.path),
                ));
            }
            let relative_path = relative_directory.join(safe_name);
            match entry.kind {
                DeviceFileKind::Directory => {
                    directories.push(relative_path.clone());
                    let mut child_ancestors = current_ancestors.clone();
                    child_ancestors.push(entry.path.clone());
                    queue.push_back((entry.path, relative_path, child_ancestors, entry_depth));
                }
                DeviceFileKind::File => {
                    let size_bytes = entry.size_bytes.ok_or_else(|| {
                        file_error(
                            "protocol-error",
                            "Device file listing omitted its size",
                            Some(entry.path.clone()),
                        )
                    })?;
                    total_bytes = total_bytes.checked_add(size_bytes).ok_or_else(|| {
                        file_error(
                            "transfer-limit",
                            "The device selection exceeds the total byte limit",
                            Some(entry.path.clone()),
                        )
                    })?;
                    if total_bytes > MAX_TRANSFER_TOTAL_BYTES {
                        return Err(file_error(
                            "transfer-limit",
                            "The device selection exceeds the total byte limit",
                            Some(entry.path),
                        ));
                    }
                    files.push(PlannedRemoteFile {
                        remote_path: entry.path,
                        relative_host_path: relative_path,
                        ancestor_directories: current_ancestors.clone(),
                        size_bytes,
                    });
                }
                DeviceFileKind::Symlink => {
                    return Err(file_error(
                        "unsafe-symlink",
                        "A device directory contains a symlink",
                        Some(entry.path),
                    ));
                }
                DeviceFileKind::Other => {
                    return Err(file_error(
                        "unsupported-file-type",
                        "A device directory contains a special filesystem entry",
                        Some(entry.path),
                    ));
                }
            }
        }
    }
    Ok(RemotePullPlan {
        kind: TransferItemKind::Directory,
        directories,
        files,
        total_bytes,
    })
}

fn local_stage_path(parent: &Path, role: &str) -> PathBuf {
    parent.join(format!(".adb-manager-stage-{role}-{}", transfer_token()))
}

fn allocate_local_stage(
    parent: &Path,
    kind: TransferItemKind,
) -> Result<PathBuf, FileManagerCommandError> {
    for _ in 0..8 {
        let candidate = local_stage_path(parent, "pull");
        let created = match kind {
            TransferItemKind::File => fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
                .map(|_| ()),
            TransferItemKind::Directory => fs::create_dir(&candidate),
        };
        match created {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(file_error(
                    "host-io-error",
                    format!("Cannot create host staging path: {error}"),
                    Some(candidate.to_string_lossy().to_string()),
                ));
            }
        }
    }
    Err(file_error(
        "staging-collision",
        "Cannot allocate a unique host staging path",
        Some(parent.to_string_lossy().to_string()),
    ))
}

fn is_managed_local_stage(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(".adb-manager-stage-"))
}

fn cleanup_local_stage(path: &Path) {
    if !is_managed_local_stage(path) {
        return;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.is_dir()
        && !metadata.file_type().is_symlink()
        && !metadata_is_reparse_point(&metadata)
    {
        let _ = fs::remove_dir_all(path);
    } else if fs::remove_file(path).is_err() {
        let _ = fs::remove_dir(path);
    }
}

#[cfg(unix)]
fn host_file_identity(
    _path: &Path,
    metadata: &fs::Metadata,
) -> Result<HostFileIdentity, FileManagerCommandError> {
    use std::os::unix::fs::MetadataExt;
    Ok(HostFileIdentity {
        volume_or_device: metadata.dev(),
        file_index: metadata.ino(),
    })
}

#[cfg(target_os = "windows")]
fn host_file_identity(
    path: &Path,
    _metadata: &fs::Metadata,
) -> Result<HostFileIdentity, FileManagerCommandError> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    type Handle = *mut c_void;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *mut c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn GetFileInformationByHandle(
            file: Handle,
            information: *mut ByHandleFileInformation,
        ) -> i32;
        fn CloseHandle(object: Handle) -> i32;
    }

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(file_error(
            "host-io-error",
            format!(
                "Cannot open the host destination for stable identity: {}",
                io::Error::last_os_error()
            ),
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
    let result = unsafe { GetFileInformationByHandle(handle, information.as_mut_ptr()) };
    let information_error = io::Error::last_os_error();
    unsafe {
        CloseHandle(handle);
    }
    if result == 0 {
        return Err(file_error(
            "host-io-error",
            format!("Cannot read stable host destination identity: {information_error}"),
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let information = unsafe { information.assume_init() };
    Ok(HostFileIdentity {
        volume_or_device: u64::from(information.volume_serial_number),
        file_index: (u64::from(information.file_index_high) << 32)
            | u64::from(information.file_index_low),
    })
}

#[cfg(not(any(unix, target_os = "windows")))]
fn host_file_identity(
    path: &Path,
    _metadata: &fs::Metadata,
) -> Result<HostFileIdentity, FileManagerCommandError> {
    Err(file_error(
        "atomic-commit-unsupported",
        "Stable host file identity is unsupported on this platform",
        Some(path.to_string_lossy().to_string()),
    ))
}

fn inspect_host_destination(
    path: &Path,
) -> Result<Option<HostDestinationSnapshot>, FileManagerCommandError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(file_error(
                "host-io-error",
                format!("Cannot inspect host destination: {error}"),
                Some(path.to_string_lossy().to_string()),
            ));
        }
    };
    if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
        return Err(file_error(
            "unsafe-symlink",
            "Refusing to replace a host symlink or reparse point",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let kind = if metadata.is_file() {
        TransferItemKind::File
    } else if metadata.is_dir() {
        TransferItemKind::Directory
    } else {
        return Err(file_error(
            "unsupported-file-type",
            "Refusing to replace a special host filesystem entry",
            Some(path.to_string_lossy().to_string()),
        ));
    };
    let identity = host_file_identity(path, &metadata)?;
    Ok(Some(HostDestinationSnapshot { kind, identity }))
}

fn validate_remote_ancestor_chain<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    file: &PlannedRemoteFile,
) -> Result<(), FileManagerCommandError> {
    for ancestor in &file.ancestor_directories {
        if probe_remote_path_kind(runner, serial, ancestor)? != ProbedRemoteKind::Directory {
            return Err(file_error(
                "source-changed",
                "A device ancestor directory changed type during transfer",
                Some(ancestor.clone()),
            ));
        }
    }
    Ok(())
}

fn execute_remote_pull_plan<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    plan: &RemotePullPlan,
    local_parent: &Path,
) -> Result<(PathBuf, String), FileManagerCommandError> {
    let stage = allocate_local_stage(local_parent, plan.kind)?;
    let result = (|| {
        if plan.kind == TransferItemKind::Directory {
            for relative_directory in &plan.directories {
                fs::create_dir(stage.join(relative_directory)).map_err(|error| {
                    file_error(
                        "name-collision",
                        format!("Cannot create a staged host directory: {error}"),
                        Some(relative_directory.to_string_lossy().to_string()),
                    )
                })?;
            }
            for file in &plan.files {
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(stage.join(&file.relative_host_path))
                    .map_err(|error| {
                        file_error(
                            "name-collision",
                            format!("Cannot reserve a staged host file: {error}"),
                            Some(file.relative_host_path.to_string_lossy().to_string()),
                        )
                    })?;
            }
        }

        let mut messages = Vec::new();
        for file in &plan.files {
            validate_remote_ancestor_chain(runner, serial, file)?;
            if probe_remote_path_kind(runner, serial, &file.remote_path)? != ProbedRemoteKind::File
            {
                return Err(file_error(
                    "source-changed",
                    "A device file changed type before it could be copied",
                    Some(file.remote_path.clone()),
                ));
            }
            let destination = if plan.kind == TransferItemKind::File {
                stage.clone()
            } else {
                stage.join(&file.relative_host_path)
            };
            let destination_arg = destination.to_str().ok_or_else(|| {
                file_error(
                    "unsupported-name-encoding",
                    "A staged host path is not valid UTF-8",
                    Some(destination.to_string_lossy().to_string()),
                )
            })?;
            let output = runner.run(
                &["pull", file.remote_path.as_str(), destination_arg],
                serial,
                FILE_TRANSFER_TIMEOUT,
            )?;
            if !output.status.success() {
                return Err(map_command_output_error(
                    &output,
                    Some(file.remote_path.clone()),
                ));
            }
            let metadata = reject_unsafe_host_metadata(&destination, "staged host file")?;
            if !metadata.is_file() || metadata.len() != file.size_bytes {
                return Err(file_error(
                    "source-changed",
                    "A device file changed size while it was being copied",
                    Some(file.remote_path.clone()),
                ));
            }
            if remote_regular_file_size(runner, serial, &file.remote_path)? != file.size_bytes {
                return Err(file_error(
                    "source-changed",
                    "A device file changed while it was being copied",
                    Some(file.remote_path.clone()),
                ));
            }
            validate_remote_ancestor_chain(runner, serial, file)?;
            let message = transfer_output_message(&output);
            if !message.is_empty() {
                messages.push(message);
            }
        }
        Ok(format!(
            "{} item(s), {} byte(s) staged safely{}",
            plan.directories.len() + plan.files.len() + 1,
            plan.total_bytes,
            if messages.is_empty() {
                String::new()
            } else {
                format!(": {}", messages.join("; "))
            }
        ))
    })();
    match result {
        Ok(message) => Ok((stage, message)),
        Err(error) => {
            cleanup_local_stage(&stage);
            Err(error)
        }
    }
}

#[cfg(target_os = "macos")]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};
    use std::os::unix::ffi::OsStrExt;
    const RENAME_EXCL: u32 = 0x0000_0004;
    unsafe extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: u32) -> c_int;
    }
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "destination contains NUL"))?;
    if unsafe { renamex_np(source.as_ptr(), destination.as_ptr(), RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};
    use std::os::unix::ffi::OsStrExt;
    const AT_FDCWD: c_int = -100;
    const RENAME_NOREPLACE: u32 = 1;
    unsafe extern "C" {
        fn renameat2(
            olddirfd: c_int,
            oldpath: *const c_char,
            newdirfd: c_int,
            newpath: *const c_char,
            flags: u32,
        ) -> c_int;
    }
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "destination contains NUL"))?;
    if unsafe {
        renameat2(
            AT_FDCWD,
            source.as_ptr(),
            AT_FDCWD,
            destination.as_ptr(),
            RENAME_NOREPLACE,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "windows")]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    }
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    } != 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn rename_no_replace(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic no-clobber rename is unsupported on this host",
    ))
}

fn unique_local_backup(parent: &Path) -> Result<PathBuf, FileManagerCommandError> {
    for _ in 0..8 {
        let candidate = local_stage_path(parent, "backup");
        match fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(candidate),
            Ok(_) => continue,
            Err(error) => {
                return Err(file_error(
                    "host-io-error",
                    format!("Cannot inspect a host backup path: {error}"),
                    Some(candidate.to_string_lossy().to_string()),
                ));
            }
        }
    }
    Err(file_error(
        "staging-collision",
        "Cannot allocate a unique host backup path",
        Some(parent.to_string_lossy().to_string()),
    ))
}

fn restore_local_backup(
    backup: &Path,
    destination: &Path,
    expected: HostDestinationSnapshot,
) -> Result<(), String> {
    rename_no_replace(backup, destination)
        .map_err(|error| format!("cannot move backup into place: {error}"))?;
    let restored = inspect_host_destination(destination)
        .map_err(|error| format!("cannot inspect restored destination: {}", error.message))?;
    let backup_after = inspect_host_destination(backup)
        .map_err(|error| format!("cannot inspect backup after restore: {}", error.message))?;
    if restored == Some(expected) && backup_after.is_none() {
        Ok(())
    } else {
        Err(format!(
            "restored identity verification failed: destination={restored:?}, backup={backup_after:?}"
        ))
    }
}

fn commit_local_stage(
    stage: &Path,
    destination: &Path,
    kind: TransferItemKind,
    overwrite: bool,
) -> Result<String, FileManagerCommandError> {
    commit_local_stage_with_hooks(stage, destination, kind, overwrite, || {}, || {})
}

#[cfg(test)]
fn commit_local_stage_with_before_backup<F>(
    stage: &Path,
    destination: &Path,
    kind: TransferItemKind,
    overwrite: bool,
    before_backup: F,
) -> Result<String, FileManagerCommandError>
where
    F: FnOnce(),
{
    commit_local_stage_with_hooks(stage, destination, kind, overwrite, before_backup, || {})
}

fn commit_local_stage_with_hooks<F, G>(
    stage: &Path,
    destination: &Path,
    kind: TransferItemKind,
    overwrite: bool,
    before_backup: F,
    after_backup: G,
) -> Result<String, FileManagerCommandError>
where
    F: FnOnce(),
    G: FnOnce(),
{
    let current = inspect_host_destination(destination)?;
    if current.is_some() && !overwrite {
        return Err(file_error(
            "conflict",
            "A host item with this name already exists",
            Some(destination.to_string_lossy().to_string()),
        ));
    }
    if let Some(current_snapshot) = current {
        if current_snapshot.kind != kind {
            return Err(file_error(
                "type-mismatch",
                "The staged item cannot replace a host item of a different type",
                Some(destination.to_string_lossy().to_string()),
            ));
        }
        let parent = destination.parent().ok_or_else(|| {
            file_error(
                "invalid-path",
                "Host destination has no parent directory",
                Some(destination.to_string_lossy().to_string()),
            )
        })?;
        before_backup();
        let backup = unique_local_backup(parent)?;
        rename_no_replace(destination, &backup).map_err(|error| {
            file_error(
                if error.kind() == io::ErrorKind::AlreadyExists {
                    "conflict"
                } else {
                    "host-commit-failed"
                },
                format!("Cannot move the existing host item to backup: {error}"),
                Some(destination.to_string_lossy().to_string()),
            )
        })?;
        after_backup();
        let backup_snapshot = match inspect_host_destination(&backup) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => {
                return Err(file_error(
                    "commit-state-unknown",
                    format!(
                        "The host destination moved, but its recovery backup is missing at {}",
                        backup.display()
                    ),
                    Some(destination.to_string_lossy().to_string()),
                ));
            }
            Err(error) => {
                return Err(file_error(
                    "commit-state-unknown",
                    format!(
                        "The host destination moved, but its recovery backup cannot be verified at {}: {}",
                        backup.display(), error.message
                    ),
                    Some(destination.to_string_lossy().to_string()),
                ));
            }
        };
        if backup_snapshot != current_snapshot {
            let rollback = restore_local_backup(&backup, destination, backup_snapshot);
            return Err(file_error(
                if rollback.is_ok() {
                    "conflict"
                } else {
                    "commit-state-unknown"
                },
                match rollback {
                    Ok(()) => "The host destination changed after inspection; the newer item was restored".to_string(),
                    Err(rollback_error) => format!(
                        "The host destination changed after inspection and could not be restored ({rollback_error}); recovery backup remains at {}",
                        backup.display()
                    ),
                },
                Some(destination.to_string_lossy().to_string()),
            ));
        }
        if let Err(error) = rename_no_replace(stage, destination) {
            let rollback = restore_local_backup(&backup, destination, current_snapshot);
            return Err(file_error(
                if rollback.is_err() {
                    "commit-state-unknown"
                } else if error.kind() == io::ErrorKind::AlreadyExists {
                    "conflict"
                } else {
                    "host-commit-failed"
                },
                match rollback {
                    Ok(()) => format!("Cannot install the staged host item; the original identity was restored: {error}"),
                    Err(rollback_error) => format!(
                        "Cannot install the staged host item ({error}) or restore the original ({rollback_error}); backup remains at {}",
                        backup.display()
                    ),
                },
                Some(destination.to_string_lossy().to_string()),
            ));
        }
        verify_local_commit(stage, destination, kind).map_err(|error| {
            file_error(
                "commit-state-unknown",
                format!(
                    "{}; recovery backup remains at {}",
                    error.message,
                    backup.display()
                ),
                Some(destination.to_string_lossy().to_string()),
            )
        })?;
        cleanup_local_stage(&backup);
        Ok("Replaced the complete conflicting host item".to_string())
    } else {
        rename_no_replace(stage, destination).map_err(|error| {
            file_error(
                if error.kind() == io::ErrorKind::AlreadyExists {
                    "conflict"
                } else if error.kind() == io::ErrorKind::Unsupported {
                    "atomic-commit-unsupported"
                } else {
                    "host-commit-failed"
                },
                format!("Cannot commit the staged host item without overwriting: {error}"),
                Some(destination.to_string_lossy().to_string()),
            )
        })?;
        verify_local_commit(stage, destination, kind)?;
        Ok("Committed without overwriting a host item".to_string())
    }
}

fn verify_local_commit(
    stage: &Path,
    destination: &Path,
    kind: TransferItemKind,
) -> Result<(), FileManagerCommandError> {
    let destination_snapshot = inspect_host_destination(destination)?;
    if !matches!(destination_snapshot, Some(snapshot) if snapshot.kind == kind) {
        return Err(file_error(
            "commit-state-unknown",
            "The committed host destination could not be verified",
            Some(destination.to_string_lossy().to_string()),
        ));
    }
    match fs::symlink_metadata(stage) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(file_error(
            "commit-state-unknown",
            "The staged host item still exists after commit",
            Some(stage.to_string_lossy().to_string()),
        )),
        Err(error) => Err(file_error(
            "commit-state-unknown",
            format!("The staged host item could not be verified after commit: {error}"),
            Some(stage.to_string_lossy().to_string()),
        )),
    }
}

fn remote_progress_destination(local_directory: &Path, source: &str) -> String {
    remote_basename(source)
        .ok()
        .and_then(|name| safe_host_component_for(&name, cfg!(target_os = "windows")).ok())
        .map(|name| local_directory.join(name).to_string_lossy().to_string())
        .unwrap_or_else(|| local_directory.to_string_lossy().to_string())
}

fn pull_remote_paths_with_progress<R: FileTransferRunner>(
    runner: &R,
    serial: &str,
    remote_paths: Vec<String>,
    local_directory: &Path,
    overwrite: bool,
    reporter: Option<&TransferProgressReporter>,
    item_offset: usize,
) -> Vec<FileTransferResult> {
    let mut results = Vec::with_capacity(remote_paths.len());
    let mut top_level_names = HashMap::<String, String>::new();
    for (index, source) in remote_paths.into_iter().enumerate() {
        let item_index = item_offset + index + 1;
        if reporter.is_some_and(TransferProgressReporter::is_cancelled) {
            break;
        }
        let progress_destination = remote_progress_destination(local_directory, &source);
        if let Some(reporter) = reporter {
            reporter.item_started(item_index, &source, &progress_destination);
        }
        let _progress = reporter.map(|reporter| TransferItemProgressGuard {
            reporter,
            index: item_index,
            source: source.clone(),
            destination: progress_destination,
        });
        let normalized_source = match normalize_remote_path(&source) {
            Ok(path) => path,
            Err(message) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        local_directory.to_string_lossy(),
                        FileTransferStatus::Failed,
                        message,
                    )
                    .with_code("invalid-path"),
                );
                continue;
            }
        };
        let basename = match remote_basename(&normalized_source) {
            Ok(name) => name,
            Err(message) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        local_directory.to_string_lossy(),
                        FileTransferStatus::Failed,
                        message,
                    )
                    .with_code("invalid-path"),
                );
                continue;
            }
        };
        let safe_name = match safe_host_component_for(&basename, cfg!(target_os = "windows")) {
            Ok(name) => name,
            Err(message) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        local_directory.to_string_lossy(),
                        FileTransferStatus::Failed,
                        message,
                    )
                    .with_code("unsafe-name"),
                );
                continue;
            }
        };
        let key = host_collision_key(&safe_name, cfg!(target_os = "windows"));
        if let Some(previous) = top_level_names.insert(key, source.clone()) {
            results.push(
                FileTransferResult::new(
                    &source,
                    local_directory.join(&safe_name).to_string_lossy(),
                    FileTransferStatus::Failed,
                    format!(
                        "This device name collides with the selected item {previous:?} on the host"
                    ),
                )
                .with_code("name-collision"),
            );
            continue;
        }
        let destination = local_directory.join(&safe_name);
        let existing_kind = match inspect_host_destination(&destination) {
            Ok(snapshot) => snapshot.map(|snapshot| snapshot.kind),
            Err(error) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        destination.to_string_lossy(),
                        FileTransferStatus::Failed,
                        error.message,
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        if existing_kind.is_some() && !overwrite {
            let result = FileTransferResult::new(
                &source,
                destination.to_string_lossy(),
                FileTransferStatus::Conflict,
                "A host item with this name already exists",
            )
            .with_code("conflict");
            let result = if existing_kind == Some(TransferItemKind::Directory)
                && matches!(
                    probe_remote_path_kind(runner, serial, &normalized_source),
                    Ok(ProbedRemoteKind::Directory)
                ) {
                result.with_item_kind(TransferItemKind::Directory)
            } else {
                result
            };
            results.push(result);
            continue;
        }
        let plan = match plan_remote_source(runner, serial, &normalized_source) {
            Ok(plan) => plan,
            Err(error) => {
                results.push(
                    FileTransferResult::new(
                        &source,
                        destination.to_string_lossy(),
                        FileTransferStatus::Failed,
                        error.message,
                    )
                    .with_code(error.code),
                );
                continue;
            }
        };
        if let Some(existing_kind) = existing_kind {
            if existing_kind != plan.kind {
                results.push(
                    FileTransferResult::new(
                        &source,
                        destination.to_string_lossy(),
                        FileTransferStatus::Failed,
                        "The device item cannot replace a host item of a different type",
                    )
                    .with_code("type-mismatch"),
                );
                continue;
            }
        }
        let (stage, transfer_message) =
            match execute_remote_pull_plan(runner, serial, &plan, local_directory) {
                Ok(result) => result,
                Err(error) => {
                    results.push(
                        FileTransferResult::new(
                            &source,
                            destination.to_string_lossy(),
                            FileTransferStatus::Failed,
                            error.message,
                        )
                        .with_code(error.code),
                    );
                    continue;
                }
            };
        match commit_local_stage(&stage, &destination, plan.kind, overwrite) {
            Ok(commit_message) => results.push(FileTransferResult::new(
                source,
                destination.to_string_lossy(),
                FileTransferStatus::Success,
                join_transfer_messages(&transfer_message, &commit_message),
            )),
            Err(error) => {
                cleanup_local_stage(&stage);
                let status = if error.code == "conflict" {
                    FileTransferStatus::Conflict
                } else {
                    FileTransferStatus::Failed
                };
                results.push(
                    FileTransferResult::new(
                        source,
                        destination.to_string_lossy(),
                        status,
                        error.message,
                    )
                    .with_code(error.code),
                );
            }
        }
    }
    results
}

fn transfer_output_message(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else if output.status.success() {
        "Transfer completed".to_string()
    } else {
        "Transfer failed without command output".to_string()
    }
}

fn next_protocol_field<'a>(fields: &[&'a [u8]], cursor: &mut usize) -> Result<&'a [u8], String> {
    let value = fields
        .get(*cursor)
        .copied()
        .ok_or_else(|| "Directory listing protocol is truncated".to_string())?;
    *cursor += 1;
    Ok(value)
}

fn parse_utf8_field(field: &[u8], label: &str) -> Result<String, String> {
    std::str::from_utf8(field)
        .map(ToOwned::to_owned)
        .map_err(|_| format!("Directory listing {label} is not valid UTF-8"))
}

fn optional_utf8_field(field: &[u8], label: &str) -> Result<Option<String>, String> {
    if field.is_empty() {
        Ok(None)
    } else {
        parse_utf8_field(field, label).map(Some)
    }
}

fn parse_bool_field(field: &[u8], label: &str) -> Result<bool, String> {
    match field {
        b"1" => Ok(true),
        b"0" => Ok(false),
        _ => Err(format!("Directory listing {label} is invalid")),
    }
}

fn parse_optional_number<T>(field: &[u8], label: &str) -> Result<Option<T>, String>
where
    T: std::str::FromStr,
{
    if field.is_empty() {
        return Ok(None);
    }
    let value = std::str::from_utf8(field)
        .map_err(|_| format!("Directory listing {label} is not valid UTF-8"))?
        .parse::<T>()
        .map_err(|_| format!("Directory listing {label} is invalid"))?;
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier, Mutex};

    #[derive(Debug, Clone)]
    struct RecordedCall {
        args: Vec<String>,
        serial: String,
        timeout: Duration,
    }

    #[derive(Default)]
    struct FakeRunner {
        responses: Mutex<VecDeque<Result<Output, FileManagerCommandError>>>,
        calls: Mutex<Vec<RecordedCall>>,
    }

    impl FakeRunner {
        fn with_responses(responses: Vec<Result<Output, FileManagerCommandError>>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<RecordedCall> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl FileTransferRunner for FakeRunner {
        fn run(
            &self,
            args: &[&str],
            serial: &str,
            timeout: Duration,
        ) -> Result<Output, FileManagerCommandError> {
            self.calls.lock().unwrap().push(RecordedCall {
                args: args.iter().map(|value| (*value).to_string()).collect(),
                serial: serial.to_string(),
                timeout,
            });
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("fake runner response")
        }
    }

    #[cfg(unix)]
    fn test_exit_status(success: bool) -> std::process::ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(if success { 0 } else { 1 << 8 })
    }

    #[cfg(windows)]
    fn test_exit_status(success: bool) -> std::process::ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(if success { 0 } else { 1 })
    }

    fn test_output(
        success: bool,
        stdout: impl Into<Vec<u8>>,
        stderr: impl Into<Vec<u8>>,
    ) -> Output {
        Output {
            status: test_exit_status(success),
            stdout: stdout.into(),
            stderr: stderr.into(),
        }
    }

    fn nul_payload(fields: &[&str]) -> Vec<u8> {
        let mut payload = Vec::new();
        for field in fields {
            payload.extend_from_slice(field.as_bytes());
            payload.push(0);
        }
        payload
    }

    fn remote_plan(kind: TransferItemKind) -> RemotePullPlan {
        RemotePullPlan {
            kind,
            directories: Vec::new(),
            files: if kind == TransferItemKind::File {
                vec![PlannedRemoteFile {
                    remote_path: "/data/stage".to_string(),
                    relative_host_path: PathBuf::new(),
                    ancestor_directories: Vec::new(),
                    size_bytes: 1,
                }]
            } else {
                Vec::new()
            },
            total_bytes: if kind == TransferItemKind::File { 1 } else { 0 },
        }
    }

    fn test_directory(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "adb-manager-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn normalizes_absolute_remote_paths_without_crossing_root() {
        assert_eq!(
            normalize_remote_path("/storage//emulated/0/./DCIM/../Pictures").unwrap(),
            "/storage/emulated/0/Pictures"
        );
        assert_eq!(normalize_remote_path("/").unwrap(), "/");
        assert!(normalize_remote_path("storage/emulated/0").is_err());
        assert!(normalize_remote_path("/../../data").is_err());
        assert!(normalize_remote_path("/data/has\0nul").is_err());
    }

    #[test]
    fn directory_listing_uses_streamed_nul_enumeration_for_bounded_pages() {
        assert!(DIRECTORY_LIST_SCRIPT.contains("find . -mindepth 1 -maxdepth 1 -print0"));
        assert!(DIRECTORY_LIST_SCRIPT.contains("while IFS= read -r -d \"\" item"));
        assert!(!DIRECTORY_LIST_SCRIPT.contains("for name in .[!.]* ..?* *"));
    }

    #[test]
    fn quotes_remote_shell_values_as_single_posix_literals() {
        assert_eq!(remote_shell_quote("a b"), "'a b'");
        assert_eq!(remote_shell_quote("a'b"), "'a'\\''b'");
        assert_eq!(
            remote_shell_quote("$(reboot); rm -rf /\n中文"),
            "'$(reboot); rm -rf /\n中文'"
        );
    }

    #[cfg(unix)]
    #[test]
    fn remote_shell_command_keeps_each_argument_literal() {
        let dangerous_path = "/storage/a'b;$(printf injected >&2)\n中文";
        let command = build_remote_shell_command("printf '%s' \"$1\"", &[dangerous_path]);
        let mut shell = crate::process::hidden_command("/bin/sh");
        let output = shell.args(["-c", &command]).output().unwrap();

        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap(), dangerous_path);
        assert!(output.stderr.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn remote_commit_scripts_are_valid_posix_shell_syntax() {
        for script in [
            REMOTE_COMMIT_NO_CLOBBER_SCRIPT,
            REMOTE_COMMIT_REPLACE_SCRIPT,
        ] {
            let mut shell = crate::process::hidden_command("/bin/sh");
            let output = shell.args(["-n", "-c", script]).output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn browsing_allows_only_directory_symlinks_and_returns_exact_canonical_path() {
        use std::os::unix::fs::symlink;

        let base = test_directory("browse-symlink");
        let target = base.join("target with trailing newline\n");
        let directory_alias = base.join("sdcard");
        let file = base.join("file");
        let file_alias = base.join("file-alias");
        let loop_alias = base.join("loop");
        fs::create_dir_all(&target).unwrap();
        fs::write(&file, b"file").unwrap();
        symlink(&target, &directory_alias).unwrap();
        symlink(&file, &file_alias).unwrap();
        symlink("loop", &loop_alias).unwrap();

        let run_listing = |path: &Path, allow_directory_symlink: &str| {
            let path = path.to_str().unwrap();
            let command = build_remote_shell_command(
                DIRECTORY_LIST_SCRIPT,
                &[path, "0", "10", allow_directory_symlink],
            );
            let mut shell = crate::process::hidden_command("/bin/sh");
            shell.args(["-c", &command]).output().unwrap()
        };

        let browse = run_listing(&directory_alias, "1");
        assert!(
            browse.status.success(),
            "{}",
            String::from_utf8_lossy(&browse.stderr)
        );
        let listing = parse_listing_payload(&browse.stdout).unwrap();
        assert_eq!(
            listing.path,
            fs::canonicalize(&target).unwrap().to_str().unwrap()
        );
        assert!(listing.path.ends_with('\n'));

        let transfer = run_listing(&directory_alias, "0");
        assert!(!transfer.status.success());
        assert!(String::from_utf8_lossy(&transfer.stderr).contains("FM_UNSAFE_SYMLINK"));

        for unsafe_alias in [&file_alias, &loop_alias] {
            let output = run_listing(unsafe_alias, "1");
            assert!(!output.status.success());
            assert!(String::from_utf8_lossy(&output.stderr).contains("FM_NOT_DIRECTORY"));
        }

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn parses_nul_listing_without_splitting_special_file_names() {
        let payload = nul_payload(&[
            "H",
            "/storage/emulated/0",
            "1",
            "1",
            "E",
            "Folder With Space",
            "directory",
            "4096",
            "1780000000",
            "drwxrwx---",
            "1",
            "1",
            "",
            "E",
            "line\nname.txt",
            "file",
            "12",
            "1780000001",
            "-rw-rw----",
            "1",
            "1",
            "",
            "E",
            "link with trailing space and newline \n",
            "symlink",
            "",
            "1780000002",
            "lrwxrwxrwx",
            "1",
            "1",
            "../target with trailing space and newline \n",
            "M",
            "1",
        ]);
        let listing = parse_listing_payload(&payload).unwrap();

        assert_eq!(listing.path, "/storage/emulated/0");
        assert!(listing.readable);
        assert!(listing.writable);
        assert!(listing.has_more);
        assert_eq!(listing.entries.len(), 3);
        assert_eq!(listing.entries[0].name, "Folder With Space");
        assert_eq!(listing.entries[0].kind, DeviceFileKind::Directory);
        assert_eq!(listing.entries[1].name, "line\nname.txt");
        assert_eq!(listing.entries[1].size_bytes, Some(12));
        assert_eq!(
            listing.entries[2].symlink_target.as_deref(),
            Some("../target with trailing space and newline \n")
        );
    }

    #[test]
    fn rejects_truncated_or_invalid_listing_protocol() {
        assert!(parse_listing_payload(&nul_payload(&[
            "H",
            "/data",
            "1",
            "1",
            "E",
            "missing-fields"
        ]))
        .is_err());
        assert!(
            parse_listing_payload(&nul_payload(&["H", "/data", "maybe", "1", "M", "0"])).is_err()
        );
        assert!(parse_listing_payload(&nul_payload(&[
            "E", "file", "file", "1", "1", "-rw", "1", "1", ""
        ]))
        .is_err());
    }

    #[test]
    fn parses_per_device_access_capabilities_and_locations() {
        let payload = nul_payload(&[
            "C",
            "2000",
            "user",
            "0",
            "0",
            "1",
            "RUNNING_UNLOCKED",
            "R",
            "/storage/emulated/0",
            "1",
            "1",
            "1",
            "R",
            "/data/data",
            "1",
            "0",
            "0",
        ]);
        let capabilities = parse_capabilities_payload(&payload).unwrap();

        assert_eq!(capabilities.effective_uid, "2000");
        assert_eq!(capabilities.access_mode, FileAccessMode::Shell);
        assert_eq!(capabilities.build_type, "user");
        assert!(!capabilities.debuggable);
        assert_eq!(capabilities.android_user_id, "0");
        assert!(capabilities.android_user_known);
        assert_eq!(capabilities.android_user_state, "RUNNING_UNLOCKED");
        assert_eq!(capabilities.locations.len(), 2);
        assert!(capabilities.locations[0].writable);
        assert!(!capabilities.locations[1].readable);
    }

    #[test]
    fn unknown_android_user_stays_unknown_without_shared_storage_shortcuts() {
        let payload = nul_payload(&[
            "C",
            "2000",
            "user",
            "0",
            "",
            "0",
            "",
            "R",
            "/data/local/tmp",
            "1",
            "1",
            "1",
        ]);
        let capabilities = parse_capabilities_payload(&payload).unwrap();

        assert!(!capabilities.android_user_known);
        assert!(capabilities.android_user_id.is_empty());
        assert!(capabilities.android_user_state.is_empty());
        assert_eq!(capabilities.locations.len(), 1);
        assert_eq!(capabilities.locations[0].path, "/data/local/tmp");
    }

    #[test]
    fn transfer_paths_reject_root_and_keep_remote_names_literal() {
        assert_eq!(
            remote_basename("/storage/emulated/0/My 文件.txt").unwrap(),
            "My 文件.txt"
        );
        assert!(remote_basename("/").is_err());
        assert_eq!(join_remote_child("/", "Download"), "/Download");
        assert_eq!(
            join_remote_child("/storage/emulated/0", "a'b;$(reboot)"),
            "/storage/emulated/0/a'b;$(reboot)"
        );
        assert!(Path::new("relative-host-path").is_relative());
        let trailing_whitespace = "/storage/emulated/0/name with trailing space and newline \n";
        assert_eq!(
            normalize_remote_path(trailing_whitespace).unwrap(),
            trailing_whitespace
        );
        assert_eq!(
            remote_basename(trailing_whitespace).unwrap(),
            "name with trailing space and newline \n"
        );
        assert_eq!(
            join_remote_child("/storage/emulated/0", "name \n"),
            "/storage/emulated/0/name \n"
        );
        assert_eq!(require_device_serial("serial \n").unwrap(), "serial \n");
    }

    #[test]
    fn windows_host_names_replace_invalid_and_reserved_segments() {
        assert_eq!(
            sanitize_windows_file_name("report:final?.txt"),
            "report_final_.txt"
        );
        assert_eq!(sanitize_windows_file_name("CON"), "_CON");
        assert_eq!(sanitize_windows_file_name("trailing. "), "trailing");
        let colon = safe_host_component_for("a:b", true).unwrap();
        let question = safe_host_component_for("a?b", true).unwrap();
        assert_eq!(colon, "a_b");
        assert_eq!(question, "a_b");
        assert_eq!(
            host_collision_key(&colon, true),
            host_collision_key(&question, true)
        );
        assert_eq!(
            host_collision_key("README", true),
            host_collision_key("Readme", true)
        );
    }

    #[test]
    fn host_source_plan_counts_regular_tree_bytes() {
        let base = test_directory("host-plan");
        let source = base.join("source");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("one.txt"), b"one").unwrap();
        fs::write(source.join("nested").join("two.txt"), b"twice").unwrap();

        let plan = plan_host_source(&source).unwrap();
        assert_eq!(plan.kind, TransferItemKind::Directory);
        assert_eq!(plan.items, 4);
        assert_eq!(plan.total_bytes, 8);

        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn host_source_plan_rejects_nested_symlinks_and_special_files() {
        use std::os::unix::fs::symlink;
        use std::os::unix::net::UnixListener;

        let unique = TRANSFER_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
        let base =
            PathBuf::from("/tmp").join(format!("afm-unsafe-{}-{unique}", std::process::id()));
        let source = base.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(base.join("outside.txt"), b"secret").unwrap();
        symlink(base.join("outside.txt"), source.join("link.txt")).unwrap();
        let symlink_error = plan_host_source(&source).unwrap_err();
        assert_eq!(symlink_error.code, "unsafe-symlink");
        fs::remove_file(source.join("link.txt")).unwrap();

        let socket_path = source.join("socket");
        let listener = UnixListener::bind(&socket_path).unwrap();
        let special_error = plan_host_source(&source).unwrap_err();
        assert_eq!(special_error.code, "unsupported-file-type");
        drop(listener);

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn remote_tree_plan_rejects_symlink_before_any_pull() {
        let listing = nul_payload(&[
            "H",
            "/data/root",
            "1",
            "1",
            "E",
            "link",
            "symlink",
            "",
            "",
            "lrwxrwxrwx",
            "1",
            "1",
            "/data/secret",
            "M",
            "0",
        ]);
        let runner = FakeRunner::with_responses(vec![
            Ok(test_output(true, b"directory".to_vec(), Vec::new())),
            Ok(test_output(true, b"directory".to_vec(), Vec::new())),
            Ok(test_output(true, listing, Vec::new())),
        ]);

        let error = plan_remote_source(&runner, "SERIAL-1", "/data/root").unwrap_err();
        assert_eq!(error.code, "unsafe-symlink");
        let calls = runner.calls();
        assert_eq!(calls.len(), 3);
        assert!(calls.iter().all(|call| call.serial == "SERIAL-1"));
        assert!(calls.iter().all(|call| call.args[0] == "shell"));
        assert!(calls
            .iter()
            .all(|call| call.timeout <= DIRECTORY_LIST_TIMEOUT));
        assert!(!calls.iter().any(|call| call.args[0] == "pull"));
    }

    #[test]
    fn remote_commit_uses_exchange_and_surfaces_racing_conflict() {
        let runner = FakeRunner::with_responses(vec![Ok(test_output(
            false,
            Vec::new(),
            b"FM_CONFLICT:/data/final".to_vec(),
        ))]);

        let error = commit_remote_stage(
            &runner,
            "SERIAL-2",
            "/data/.adb-manager-stage-test",
            "/data/final",
            &remote_plan(TransferItemKind::File),
            ProbedRemoteKind::Missing,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, "conflict");
        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].timeout, FILE_TRANSFER_TIMEOUT);
        assert!(calls[0].args[1].contains("mv -xT --"));
        assert!(calls[0].args[1].contains("placeholder_id"));
        assert!(calls[0].args[1].contains("'file'"));
    }

    #[cfg(unix)]
    #[test]
    fn replace_exchange_reports_unknown_state_when_rollback_does_not_restore_both_items() {
        use std::os::unix::fs::PermissionsExt;

        let base = test_directory("replace-exchange-rollback");
        let fake_bin = base.join("bin");
        let stage = base.join(".adb-manager-stage-test");
        let destination = base.join("final");
        let mv_count = base.join("mv-count");
        fs::create_dir_all(&fake_bin).unwrap();
        fs::write(&stage, b"new").unwrap();
        fs::write(&destination, b"old").unwrap();

        let fake_mv = fake_bin.join("mv");
        fs::write(
            &fake_mv,
            r#"#!/bin/sh
if [ "$1" = "--help" ]; then
  printf '[-xT]'
  exit 0
fi
count=0
if [ -f "$FM_TEST_MV_COUNT" ]; then
  IFS= read -r count < "$FM_TEST_MV_COUNT"
fi
count=$((count + 1))
printf '%s' "$count" > "$FM_TEST_MV_COUNT"
if [ "$count" -eq 1 ]; then
  /bin/rm -f "$4"
  exit 0
fi
exit 1
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_mv, fs::Permissions::from_mode(0o755)).unwrap();

        let fake_stat = fake_bin.join("stat");
        fs::write(
            &fake_stat,
            r#"#!/bin/sh
path=$3
[ -e "$path" ] || exit 1
/usr/bin/stat -f '%d:%i' "$path"
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_stat, fs::Permissions::from_mode(0o755)).unwrap();

        let stage_arg = stage.to_str().unwrap();
        let destination_arg = destination.to_str().unwrap();
        let command = build_remote_shell_command(
            REMOTE_COMMIT_REPLACE_SCRIPT,
            &[stage_arg, destination_arg, "file"],
        );
        let test_path = format!("{}:/bin:/usr/bin", fake_bin.display());
        let mut shell = crate::process::hidden_command("/bin/sh");
        let output = shell
            .args(["-c", &command])
            .env("PATH", test_path)
            .env("FM_TEST_MV_COUNT", &mv_count)
            .output()
            .unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        fs::remove_dir_all(&base).unwrap();

        assert!(!output.status.success());
        assert_eq!(stderr, format!("FM_ROLLBACK_FAILED:{stage_arg}"));
        assert_eq!(command_failure_code(&stderr), "commit-state-unknown");
        assert!(commit_error_requires_preserved_staging(
            "commit-state-unknown"
        ));
    }

    #[test]
    fn remote_commit_never_accepts_failure_marker_with_success_host_status() {
        let runner = FakeRunner::with_responses(vec![Ok(test_output(
            true,
            b"FM_ATOMIC_COMMIT_FAILED:/data/final".to_vec(),
            Vec::new(),
        ))]);

        let error = commit_remote_stage(
            &runner,
            "SERIAL-2",
            "/data/.adb-manager-stage-test",
            "/data/final",
            &remote_plan(TransferItemKind::Directory),
            ProbedRemoteKind::Missing,
            false,
        )
        .unwrap_err();

        assert_eq!(error.code, "atomic-commit-failed");
        assert_eq!(runner.calls().len(), 1);
    }

    #[test]
    fn remote_commit_rejects_false_success_when_stage_was_not_committed() {
        let runner = FakeRunner::with_responses(vec![
            Ok(test_output(true, b"ok:fallback".to_vec(), Vec::new())),
            Ok(test_output(true, b"missing".to_vec(), Vec::new())),
            Ok(test_output(true, b"directory".to_vec(), Vec::new())),
        ]);

        let error = commit_remote_stage(
            &runner,
            "SERIAL-2",
            "/data/.adb-manager-stage-test",
            "/data/final",
            &remote_plan(TransferItemKind::Directory),
            ProbedRemoteKind::Missing,
            false,
        )
        .unwrap_err();

        assert_eq!(error.code, "atomic-commit-failed");
        assert_eq!(runner.calls().len(), 3);
    }

    #[test]
    fn remote_commit_accepts_only_a_fully_verified_fallback_sequence() {
        let runner = FakeRunner::with_responses(vec![
            Ok(test_output(true, b"ok:fallback".to_vec(), Vec::new())),
            Ok(test_output(true, b"file".to_vec(), Vec::new())),
            Ok(test_output(true, b"missing".to_vec(), Vec::new())),
            Ok(test_output(true, b"missing".to_vec(), Vec::new())),
            Ok(test_output(true, b"file".to_vec(), Vec::new())),
            Ok(test_output(true, b"1".to_vec(), Vec::new())),
        ]);

        let message = commit_remote_stage(
            &runner,
            "SERIAL-2",
            "/data/.adb-manager-stage-test",
            "/data/final",
            &remote_plan(TransferItemKind::File),
            ProbedRemoteKind::Missing,
            false,
        )
        .unwrap();

        assert!(message.contains("verified non-atomic fallback"));
        let calls = runner.calls();
        assert_eq!(calls.len(), 6);
        assert!(calls.iter().all(|call| call.args[0] == "shell"));
        assert!(calls[0].args[1].contains("mv -nT --"));
    }

    #[test]
    fn injected_runner_preserves_timeout_and_literal_remote_arguments() {
        let runner =
            FakeRunner::with_responses(vec![Ok(test_output(true, b"file".to_vec(), Vec::new()))]);
        let dangerous = "/data/a'b;$(reboot)\nname";

        let kind = probe_remote_path_kind(&runner, "serial-explicit", dangerous).unwrap();
        assert_eq!(kind, ProbedRemoteKind::File);
        let calls = runner.calls();
        assert_eq!(calls[0].args[0], "shell");
        assert_eq!(calls[0].serial, "serial-explicit");
        assert_eq!(calls[0].timeout, PATH_PROBE_TIMEOUT);
        assert!(calls[0].args[1].contains(&remote_shell_quote(dangerous)));
    }

    #[test]
    fn canonical_directory_probe_preserves_trailing_space_and_newline() {
        let exact_path = "/data/folder with trailing space and newline \n";
        let mut payload = exact_path.as_bytes().to_vec();
        payload.push(0);
        let runner = FakeRunner::with_responses(vec![Ok(test_output(true, payload, Vec::new()))]);

        assert_eq!(
            ensure_remote_directory(&runner, "serial", exact_path).unwrap(),
            exact_path
        );
        assert_eq!(normalize_remote_path(exact_path).unwrap(), exact_path);
        let calls = runner.calls();
        assert!(calls[0].args[1].contains(&remote_shell_quote(exact_path)));
    }

    #[test]
    fn local_no_clobber_commit_has_exactly_one_winner() {
        let base = test_directory("commit-race");
        fs::create_dir_all(&base).unwrap();
        let destination = base.join("final.txt");
        let stage_one = local_stage_path(&base, "one");
        let stage_two = local_stage_path(&base, "two");
        fs::write(&stage_one, b"one").unwrap();
        fs::write(&stage_two, b"two").unwrap();
        let barrier = Arc::new(Barrier::new(3));

        let start_one = barrier.clone();
        let destination_one = destination.clone();
        let handle_one = std::thread::spawn(move || {
            start_one.wait();
            commit_local_stage(&stage_one, &destination_one, TransferItemKind::File, false)
        });
        let start_two = barrier.clone();
        let destination_two = destination.clone();
        let handle_two = std::thread::spawn(move || {
            start_two.wait();
            commit_local_stage(&stage_two, &destination_two, TransferItemKind::File, false)
        });
        barrier.wait();
        let outcomes = [handle_one.join().unwrap(), handle_two.join().unwrap()];

        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| result.as_ref().is_err_and(|error| error.code == "conflict"))
                .count(),
            1
        );
        assert!(matches!(
            fs::read(&destination).unwrap().as_slice(),
            b"one" | b"two"
        ));

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn host_overwrite_rejects_same_type_destination_replaced_after_inspection() {
        let base = test_directory("host-overwrite-identity");
        let destination = base.join("final.txt");
        let replacement = base.join("racing.txt");
        let stage = local_stage_path(&base, "new");
        fs::create_dir_all(&base).unwrap();
        fs::write(&destination, b"original").unwrap();
        fs::write(&replacement, b"racing writer").unwrap();
        fs::write(&stage, b"new transfer").unwrap();

        let raced_destination = destination.clone();
        let error = commit_local_stage_with_before_backup(
            &stage,
            &destination,
            TransferItemKind::File,
            true,
            move || fs::rename(&replacement, &raced_destination).unwrap(),
        )
        .unwrap_err();

        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read(&destination).unwrap(), b"racing writer");
        assert_eq!(fs::read(&stage).unwrap(), b"new transfer");
        assert_eq!(
            fs::read_dir(&base)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| is_managed_local_stage(&entry.path()))
                .count(),
            1
        );

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn host_overwrite_preserves_recovery_when_raced_destination_cannot_be_restored() {
        let base = test_directory("host-overwrite-rollback");
        let destination = base.join("final.txt");
        let replacement = base.join("racing.txt");
        let stage = local_stage_path(&base, "new");
        fs::create_dir_all(&base).unwrap();
        fs::write(&destination, b"original").unwrap();
        fs::write(&replacement, b"racing writer").unwrap();
        fs::write(&stage, b"new transfer").unwrap();

        let raced_destination = destination.clone();
        let occupied_destination = destination.clone();
        let error = commit_local_stage_with_hooks(
            &stage,
            &destination,
            TransferItemKind::File,
            true,
            move || fs::rename(&replacement, &raced_destination).unwrap(),
            move || fs::write(&occupied_destination, b"third party").unwrap(),
        )
        .unwrap_err();

        assert_eq!(error.code, "commit-state-unknown");
        assert_eq!(fs::read(&destination).unwrap(), b"third party");
        assert_eq!(fs::read(&stage).unwrap(), b"new transfer");
        let recovery_paths = fs::read_dir(&base)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| is_managed_local_stage(path) && path != &stage)
            .collect::<Vec<_>>();
        assert_eq!(recovery_paths.len(), 1);
        assert_eq!(fs::read(&recovery_paths[0]).unwrap(), b"racing writer");

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn overwrite_replaces_complete_directory_and_rejects_type_mismatch() {
        let base = test_directory("commit-replace");
        let destination = base.join("folder");
        let stage = local_stage_path(&base, "directory");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("old.txt"), b"old").unwrap();
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("new.txt"), b"new").unwrap();

        commit_local_stage(&stage, &destination, TransferItemKind::Directory, true).unwrap();
        assert!(!destination.join("old.txt").exists());
        assert_eq!(fs::read(destination.join("new.txt")).unwrap(), b"new");

        let file_stage = local_stage_path(&base, "file");
        fs::write(&file_stage, b"file").unwrap();
        let error = commit_local_stage(&file_stage, &destination, TransferItemKind::File, true)
            .unwrap_err();
        assert_eq!(error.code, "type-mismatch");
        cleanup_local_stage(&file_stage);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn transfer_batch_counts_success_conflicts_and_failures() {
        let batch = FileTransferBatch::from_results(vec![
            FileTransferResult::new("a", "A", FileTransferStatus::Success, "done"),
            FileTransferResult::new("b", "B", FileTransferStatus::Conflict, "exists"),
            FileTransferResult::new("c", "C", FileTransferStatus::Failed, "offline"),
        ]);

        assert_eq!(batch.succeeded, 1);
        assert_eq!(batch.conflicts, 1);
        assert_eq!(batch.failed, 1);
    }

    #[test]
    fn classifies_actionable_device_file_failures() {
        assert_eq!(
            command_failure_code("FM_PERMISSION_DENIED:/data/data"),
            "permission-denied"
        );
        assert_eq!(
            command_failure_code("No such file or directory"),
            "not-found"
        );
        assert_eq!(command_failure_code("Read-only file system"), "read-only");
        assert_eq!(command_failure_code("No space left on device"), "no-space");
        assert_eq!(command_failure_code("FM_CONFLICT:/data/name"), "conflict");
        assert_eq!(
            command_failure_code("FM_ATOMIC_UNSUPPORTED:mv-exchange"),
            "atomic-commit-unsupported"
        );
        assert_eq!(
            command_failure_code("FM_ROLLBACK_FAILED:/data/.adb-manager-stage.backup"),
            "commit-state-unknown"
        );
        assert_eq!(
            command_failure_code("FM_STAGE_MISSING:/data/.adb-manager-stage"),
            "source-changed"
        );
        assert!(commit_error_requires_preserved_staging(
            "commit-state-unknown"
        ));
        assert_eq!(
            command_failure_code("error: device unauthorized"),
            "transport-error"
        );
        assert_eq!(
            command_failure_code("error: device 'ABC 123' not found"),
            "transport-error"
        );
        assert_eq!(
            command_failure_code("adb: error: failed to get feature set: device 'ABC' not found"),
            "transport-error"
        );
        assert_eq!(
            command_failure_code("error: device ABC not found"),
            "transport-error"
        );
        assert_eq!(
            command_failure_code("error: no devices/emulators found"),
            "transport-error"
        );
        assert_eq!(
            command_failure_code("FM_NOT_FOUND:/data/error: device ABC not found"),
            "not-found"
        );
        assert_eq!(
            command_failure_code("unexpected toybox failure"),
            "command-failed"
        );
    }

    #[test]
    fn command_errors_preserve_path_trailing_whitespace() {
        let exact_path = "/data/name with trailing space and newline \n";
        let detail = format!("FM_NOT_FOUND:{exact_path}");
        let output = test_output(false, Vec::new(), detail.as_bytes().to_vec());

        let error = map_command_output_error(&output, Some(exact_path.to_string()));

        assert_eq!(error.code, "not-found");
        assert_eq!(error.message, detail);
        assert_eq!(error.path.as_deref(), Some(exact_path));
    }
}
