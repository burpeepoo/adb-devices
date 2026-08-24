import assert from "node:assert/strict";
import test from "node:test";
import {
  breadcrumbsForRemotePath,
  formatFileSize,
  isCopyableDeviceEntry,
  isNavigableDeviceEntry,
  joinRemotePath,
  mergeDirectoryEntries,
  mergeTransferRetry,
  normalizeRemotePath,
  parentRemotePath,
  sortDirectoryEntries,
  uniqueExactPaths,
  type DeviceFileEntry,
} from "../src/fileManagerModel.ts";

const entry = (path: string, name = path.split("/").pop() || path): DeviceFileEntry => ({
  name,
  path,
  kind: "file",
  sizeBytes: 1,
  modifiedEpochSeconds: 1,
  mode: "0644",
  readable: true,
  writable: true,
  hidden: name.startsWith("."),
  symlinkTarget: null,
});

test("remote navigation preserves valid path whitespace while normalizing segments", () => {
  assert.equal(
    normalizeRemotePath("/storage//emulated/0/./DCIM/../Pictures "),
    "/storage/emulated/0/Pictures ",
  );
  assert.equal(normalizeRemotePath("/storage/emulated/0/line\n"), "/storage/emulated/0/line\n");
  assert.equal(normalizeRemotePath("/"), "/");
  assert.equal(normalizeRemotePath(""), null);
  assert.equal(normalizeRemotePath(" /storage/emulated/0"), null);
  assert.equal(normalizeRemotePath("/../../data"), null);
  assert.equal(normalizeRemotePath("storage/emulated/0"), null);
  assert.equal(normalizeRemotePath("/data/has\0nul"), null);
});

test("real transfer paths are deduplicated without trimming or percent decoding", () => {
  assert.deepEqual(
    uniqueExactPaths(["/tmp/literal%20name ", "/tmp/literal%20name ", "", "/tmp/quoted'name"]),
    ["/tmp/literal%20name ", "/tmp/quoted'name"],
  );
});

test("remote navigation handles parent, child, and breadcrumb paths", () => {
  assert.equal(parentRemotePath("/storage/emulated/0"), "/storage/emulated");
  assert.equal(parentRemotePath("/"), "/");
  assert.equal(joinRemotePath("/storage/emulated/0", "Folder With 空格"), "/storage/emulated/0/Folder With 空格");
  assert.deepEqual(breadcrumbsForRemotePath("/storage/emulated/0/DCIM"), [
    { label: "/", path: "/" },
    { label: "storage", path: "/storage" },
    { label: "emulated", path: "/storage/emulated" },
    { label: "0", path: "/storage/emulated/0" },
    { label: "DCIM", path: "/storage/emulated/0/DCIM" },
  ]);
});

test("directory pages append without duplicate paths and replace updated metadata", () => {
  const first = [entry("/Download/a.txt"), entry("/Download/b.txt")];
  const updatedB = { ...entry("/Download/b.txt"), sizeBytes: 99 };
  const merged = mergeDirectoryEntries(first, [updatedB, entry("/Download/c.txt")]);

  assert.deepEqual(merged.map((item) => item.path), [
    "/Download/a.txt",
    "/Download/b.txt",
    "/Download/c.txt",
  ]);
  assert.equal(merged[1].sizeBytes, 99);
});

test("directory sorting is stable, natural, and keeps folders first", () => {
  const entries = [
    entry("/Download/file10.txt", "file10.txt"),
    { ...entry("/Download/Folder 2", "Folder 2"), kind: "directory" as const },
    entry("/Download/file2.txt", "file2.txt"),
    { ...entry("/Download/folder 10", "folder 10"), kind: "directory" as const },
  ];

  assert.deepEqual(sortDirectoryEntries(entries).map((item) => item.name), [
    "Folder 2",
    "folder 10",
    "file2.txt",
    "file10.txt",
  ]);
  assert.deepEqual(entries.map((item) => item.name), [
    "file10.txt",
    "Folder 2",
    "file2.txt",
    "folder 10",
  ]);
});

test("only regular files and directories are transferable", () => {
  assert.equal(isCopyableDeviceEntry(entry("/Download/a.txt")), true);
  assert.equal(isCopyableDeviceEntry({ ...entry("/Download/folder"), kind: "directory" }), true);
  assert.equal(isCopyableDeviceEntry({ ...entry("/Download/link"), kind: "symlink" }), false);
  assert.equal(isCopyableDeviceEntry({ ...entry("/Download/socket"), kind: "other" }), false);
});

test("readable directory links can be opened without becoming transferable", () => {
  const directoryLink = {
    ...entry("/sdcard", "sdcard"),
    kind: "symlink" as const,
    symlinkTarget: "/storage/self/primary",
  };
  assert.equal(isNavigableDeviceEntry(directoryLink), true);
  assert.equal(isCopyableDeviceEntry(directoryLink), false);
  assert.equal(isNavigableDeviceEntry({ ...directoryLink, readable: false }), false);
});

test("file sizes stay compact and distinguish unknown values", () => {
  assert.equal(formatFileSize(null), "—");
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(1024), "1 KB");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(1024 ** 3), "1 GB");
});

test("conflict retry replaces only matching results and keeps the original batch evidence", () => {
  const original = {
    results: [
      { source: "host-a", destination: "/device/a", status: "success" as const, message: "done" },
      { source: "host-b", destination: "/device/b", status: "conflict" as const, message: "exists" },
      { source: "host-c", destination: "/device/c", status: "failed" as const, message: "offline" },
    ],
    succeeded: 1,
    conflicts: 1,
    failed: 1,
  };
  const retry = {
    results: [
      { source: "host-b", destination: "/device/b", status: "success" as const, message: "replaced" },
    ],
    succeeded: 1,
    conflicts: 0,
    failed: 0,
  };

  const merged = mergeTransferRetry(original, retry);
  assert.deepEqual(merged.results.map((result) => result.status), ["success", "success", "failed"]);
  assert.deepEqual({
    succeeded: merged.succeeded,
    conflicts: merged.conflicts,
    failed: merged.failed,
  }, { succeeded: 2, conflicts: 0, failed: 1 });
  assert.equal(merged.results[2].message, "offline");
});
