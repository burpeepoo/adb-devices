export type DeviceFileKind = "file" | "directory" | "symlink" | "other";

export interface DeviceFileEntry {
  name: string;
  path: string;
  kind: DeviceFileKind;
  sizeBytes: number | null;
  modifiedEpochSeconds: number | null;
  mode: string | null;
  readable: boolean;
  writable: boolean;
  hidden: boolean;
  symlinkTarget: string | null;
}

export interface DeviceDirectoryListing {
  path: string;
  readable: boolean;
  writable: boolean;
  entries: DeviceFileEntry[];
  hasMore: boolean;
  offset: number;
  nextOffset: number;
  limit: number;
}

export type FileAccessMode = "shell" | "root";

export interface DevicePathCapability {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
}

export interface FileManagerCapabilities {
  effectiveUid: string;
  accessMode: FileAccessMode;
  buildType: string;
  debuggable: boolean;
  androidUserId: string;
  androidUserKnown: boolean;
  androidUserState: string;
  locations: DevicePathCapability[];
}

export type FileTransferStatus = "success" | "conflict" | "failed";

export interface FileTransferResult {
  source: string;
  destination: string;
  status: FileTransferStatus;
  message: string;
  code?: string;
  itemKind?: "file" | "directory";
}

export type FileManagerMessageTranslator = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

export function fileTransferResultMessage(
  result: FileTransferResult,
  translate: FileManagerMessageTranslator,
): string {
  return result.code
    ? translate(`fileManager.transferErrors.${result.code}`, result.message, { path: result.destination })
    : result.message;
}

export interface FileTransferBatch {
  results: FileTransferResult[];
  succeeded: number;
  conflicts: number;
  failed: number;
}

export interface FileTransferProgress {
  transferId: string;
  operation: "push" | "pull";
  phase: "preparing" | "transferring" | "item-processed" | "completed" | "cancelled";
  currentIndex: number;
  totalItems: number;
  processedItems: number;
  currentSource: string | null;
  currentDestination: string | null;
  elapsedMs: number;
  message: string;
}

export interface FileManagerCommandError {
  code: string;
  message: string;
  path: string | null;
}

export interface RemoteBreadcrumb {
  label: string;
  path: string;
}

export function uniqueExactPaths(paths: readonly string[]): string[] {
  // Picker, drag/drop, and backend result values are real paths. Preserve edge
  // whitespace and literal percent sequences.
  return Array.from(new Set(paths.filter((path) => path.length > 0)));
}

export function normalizeRemotePath(value: string): string | null {
  if (!value.startsWith("/") || value.includes("\0")) return null;

  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path) ?? "/";
  if (normalized === "/") return "/";
  const lastSeparator = normalized.lastIndexOf("/");
  return lastSeparator <= 0 ? "/" : normalized.slice(0, lastSeparator);
}

export function joinRemotePath(parent: string, child: string): string {
  const normalizedParent = normalizeRemotePath(parent) ?? "/";
  return normalizedParent === "/" ? `/${child}` : `${normalizedParent}/${child}`;
}

export function breadcrumbsForRemotePath(path: string): RemoteBreadcrumb[] {
  const normalized = normalizeRemotePath(path) ?? "/";
  const breadcrumbs: RemoteBreadcrumb[] = [{ label: "/", path: "/" }];
  if (normalized === "/") return breadcrumbs;

  let current = "";
  for (const segment of normalized.slice(1).split("/")) {
    current += `/${segment}`;
    breadcrumbs.push({ label: segment, path: current });
  }
  return breadcrumbs;
}

export function mergeDirectoryEntries(
  current: readonly DeviceFileEntry[],
  incoming: readonly DeviceFileEntry[],
): DeviceFileEntry[] {
  const byPath = new Map(current.map((item) => [item.path, item]));
  for (const item of incoming) byPath.set(item.path, item);
  return Array.from(byPath.values());
}

const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const kindOrder: Record<DeviceFileKind, number> = {
  directory: 0,
  file: 1,
  symlink: 2,
  other: 3,
};

export function sortDirectoryEntries(entries: readonly DeviceFileEntry[]): DeviceFileEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const kindDifference = kindOrder[left.entry.kind] - kindOrder[right.entry.kind];
      if (kindDifference !== 0) return kindDifference;
      const nameDifference = naturalNameCollator.compare(left.entry.name, right.entry.name);
      return nameDifference !== 0 ? nameDifference : left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function isCopyableDeviceEntry(entry: DeviceFileEntry): boolean {
  return entry.kind === "file" || entry.kind === "directory";
}

export function isNavigableDeviceEntry(entry: DeviceFileEntry): boolean {
  return entry.kind === "directory" || (entry.kind === "symlink" && entry.readable);
}

export function formatFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function formatModifiedTime(
  modifiedEpochSeconds: number | null,
  locale?: string,
): string {
  if (modifiedEpochSeconds === null || !Number.isFinite(modifiedEpochSeconds)) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(modifiedEpochSeconds * 1000));
}

export function summarizeTransferResults(results: readonly FileTransferResult[]): FileTransferBatch {
  return {
    results: [...results],
    succeeded: results.filter((result) => result.status === "success").length,
    conflicts: results.filter((result) => result.status === "conflict").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}

export function mergeTransferRetry(
  original: FileTransferBatch,
  retry: FileTransferBatch,
): FileTransferBatch {
  const retried = new Map(
    retry.results.map((result) => [`${result.source}\0${result.destination}`, result] as const),
  );
  const merged = original.results.map((result) =>
    retried.get(`${result.source}\0${result.destination}`) ?? result,
  );
  for (const [key, result] of retried) {
    if (!original.results.some((item) => `${item.source}\0${item.destination}` === key)) {
      merged.push(result);
    }
  }
  return summarizeTransferResults(merged);
}
