import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { DeviceTargetState } from "../deviceTarget.ts";
import {
  breadcrumbsForRemotePath,
  formatFileSize,
  formatModifiedTime,
  fileTransferResultMessage,
  isCopyableDeviceEntry,
  isNavigableDeviceEntry,
  mergeTransferRetry,
  mergeDirectoryEntries,
  normalizeRemotePath,
  parentRemotePath,
  sortDirectoryEntries,
  uniqueExactPaths,
  type DeviceDirectoryListing,
  type DeviceFileEntry,
  type FileManagerCapabilities,
  type FileManagerCommandError,
  type FileTransferBatch,
  type FileTransferProgress,
  type FileTransferResult,
} from "../fileManagerModel.ts";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import ResultAlert from "./common/ResultAlert";
import SectionTitle from "./common/SectionTitle";
import FileTransferDrawer, {
  type TransferCenterDirection,
  type TransferCenterPhase,
} from "./FileTransferDrawer";
import FileDetailsDrawer from "./FileDetailsDrawer";
import "./FileManager.css";

interface Props {
  deviceTarget: DeviceTargetState;
  active: boolean;
}

interface TargetSnapshot {
  identity: string;
  serial: string;
}

interface ListingView {
  targetKey: string;
  listing: DeviceDirectoryListing;
}

interface CapabilityView {
  targetKey: string;
  capabilities: FileManagerCapabilities;
}

interface Notice {
  ok: boolean;
  msg: string;
  warning?: boolean;
  detail?: string;
  issues?: FileTransferResult[];
}

type ListPhase = "idle" | "loading" | "loading-more" | "ready" | "permission-denied" | "error";
type Operation = "push" | "pull" | null;
type Translate = (key: string, fallback: string, values?: Record<string, string | number>) => string;

interface PendingTransfer {
  id: string;
  direction: TransferCenterDirection;
  sourcePaths: string[];
  remoteDirectory?: string;
  localDirectory?: string;
  destination: string;
}

const FALLBACK_REMOTE_PATH = "/";
const DIRECTORY_PAGE_SIZE = 250;

const SHARED_LOCATION_LABELS: Record<string, { key: string; fallback: string }> = {
  "": { key: "sharedStorage", fallback: "Shared storage" },
  "/DCIM": { key: "camera", fallback: "Camera" },
  "/Pictures": { key: "pictures", fallback: "Pictures" },
  "/Movies": { key: "movies", fallback: "Movies" },
  "/Music": { key: "music", fallback: "Music" },
  "/Download": { key: "downloads", fallback: "Downloads" },
  "/Documents": { key: "documents", fallback: "Documents" },
  "/Android/data": { key: "androidData", fallback: "Android data" },
  "/Android/obb": { key: "androidObb", fallback: "Android OBB" },
};

const ABSOLUTE_LOCATION_LABELS: Record<string, { key: string; fallback: string }> = {
  "/data/local/tmp": { key: "temporary", fallback: "ADB temporary" },
  "/system": { key: "system", fallback: "System" },
  "/data": { key: "data", fallback: "App data" },
  "/": { key: "root", fallback: "Filesystem root" },
};

function sharedStorageRoot(capabilities: FileManagerCapabilities): string | null {
  if (!capabilities.androidUserKnown) return null;
  const expected = `/storage/emulated/${capabilities.androidUserId}`;
  return capabilities.locations.find((location) => location.path === expected)?.path
    ?? capabilities.locations.find((location) => /^\/storage\/emulated\/[^/]+$/.test(location.path))?.path
    ?? null;
}

function initialRemotePath(capabilities: FileManagerCapabilities): string {
  const sharedRoot = sharedStorageRoot(capabilities);
  if (sharedRoot) {
    const sharedCapability = capabilities.locations.find((location) => location.path === sharedRoot);
    if (sharedCapability?.exists && sharedCapability.readable) return sharedRoot;
  }
  return FALLBACK_REMOTE_PATH;
}

function locationLabel(path: string, sharedRoot: string | null) {
  if (sharedRoot && (path === sharedRoot || path.startsWith(`${sharedRoot}/`))) {
    const suffix = path.slice(sharedRoot.length);
    return SHARED_LOCATION_LABELS[suffix] ?? {
      key: "sharedFolder",
      fallback: suffix.split("/").filter(Boolean).join(" / ") || "Shared storage",
    };
  }
  return ABSOLUTE_LOCATION_LABELS[path] ?? {
    key: "devicePath",
    fallback: path,
  };
}

function targetSnapshot(target: DeviceTargetState): TargetSnapshot | null {
  if (target.status !== "ready" || !target.serial) return null;
  return { identity: target.identity, serial: target.serial };
}

function snapshotKey(snapshot: TargetSnapshot | null): string {
  return snapshot ? `${snapshot.identity}\0${snapshot.serial}` : "";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) return !target.readOnly;
  return target instanceof HTMLSelectElement;
}

function isTransferableDeviceEntry(entry: DeviceFileEntry): boolean {
  return entry.readable && isCopyableDeviceEntry(entry);
}

function normalizeCommandError(error: unknown): FileManagerCommandError {
  if (error && typeof error === "object") {
    const candidate = error as Partial<FileManagerCommandError>;
    if (typeof candidate.message === "string") {
      return {
        code: typeof candidate.code === "string" ? candidate.code : "unknown",
        message: candidate.message,
        path: typeof candidate.path === "string" ? candidate.path : null,
      };
    }
  }

  const raw = String(error);
  try {
    const parsed = JSON.parse(raw) as Partial<FileManagerCommandError>;
    if (typeof parsed.message === "string") {
      return {
        code: typeof parsed.code === "string" ? parsed.code : "unknown",
        message: parsed.message,
        path: typeof parsed.path === "string" ? parsed.path : null,
      };
    }
  } catch {
    // Tauri can reject with either a serialized object or an ordinary string.
  }

  const lower = raw.toLowerCase();
  const code = lower.includes("permission denied")
    ? "permission-denied"
    : lower.includes("no such file")
      ? "not-found"
      : lower.includes("read-only")
        ? "read-only"
        : "unknown";
  return { code, message: raw, path: null };
}

function commandErrorMessage(error: unknown, tx: Translate): string {
  const detail = normalizeCommandError(error);
  const location = detail.path ? ` (${detail.path})` : "";
  switch (detail.code) {
    case "permission-denied":
      return tx(
        "fileManager.permissionDenied",
        `Android denied access to this location${location}. Try a readable parent path or a root-enabled device.`,
      );
    case "not-found":
      return tx("fileManager.notFound", `The device path no longer exists${location}.`);
    case "not-directory":
      return tx("fileManager.errors.notDirectory", `This device path is not a folder${location}.`);
    case "read-only":
      return tx("fileManager.readOnly", `This location is read-only${location}.`);
    case "transport-error":
    case "device-required":
      return tx("fileManager.transportError", "The selected device is no longer available.");
    case "timeout":
      return tx("fileManager.errors.timeout", "The device did not respond in time. Try again.");
    case "cancelled":
      return tx("fileManager.transferCancelled", "Transfer cancelled.");
    case "invalid-path":
      return tx("fileManager.invalidPath", "Enter an absolute device path that starts with /.");
    default:
      return tx(
        `fileManager.transferErrors.${detail.code}`,
        detail.message || tx("fileManager.loadFailed", "The file operation failed.", { message: "" }),
        { path: detail.path ?? "" },
      );
  }
}

function transferResultKey(result: FileTransferResult): string {
  return `${result.source}\0${result.destination}`;
}

function transferNotice(batch: FileTransferBatch, tx: Translate): Notice {
  const msg = tx(
    "fileManager.transferSummary",
    `${batch.succeeded} completed; ${batch.conflicts} conflicts; ${batch.failed} failed.`,
    {
      succeeded: batch.succeeded,
      conflicts: batch.conflicts,
      failed: batch.failed,
    },
  );
  return {
    ok: batch.failed === 0 && batch.conflicts === 0,
    warning: batch.failed > 0 || batch.conflicts > 0,
    msg,
    issues: batch.results.filter((result) => result.status !== "success"),
  };
}

function SvgIcon({ children, size = 18, className }: {
  children: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function FolderIcon({ size = 18, open = false }: { size?: number; open?: boolean }) {
  return open ? (
    <SvgIcon size={size}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6A2 2 0 0 1 18.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </SvgIcon>
  ) : (
    <SvgIcon size={size}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </SvgIcon>
  );
}

function EntryIcon({ entry }: { entry: DeviceFileEntry }) {
  if (entry.kind === "directory") return <FolderIcon size={17} />;
  if (entry.kind === "symlink") {
    return (
      <SvgIcon size={17}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </SvgIcon>
    );
  }
  return (
    <SvgIcon size={17}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <polyline points="14 2 14 8 20 8" />
    </SvgIcon>
  );
}

function Spinner() {
  return <span className="file-manager-spinner" aria-hidden="true" />;
}

export default function FileManager({ deviceTarget, active }: Props) {
  const { t, i18n } = useTranslation();
  const tx = useCallback<Translate>((key, fallback, values) => {
    const translated = String(t(key, values));
    return translated === key ? fallback : translated;
  }, [t]);
  const txRef = useRef<Translate>(tx);
  txRef.current = tx;

  const snapshot = targetSnapshot(deviceTarget);
  const targetKey = snapshotKey(snapshot);
  const targetRef = useRef<TargetSnapshot | null>(snapshot);
  targetRef.current = snapshot;

  const [currentPath, setCurrentPath] = useState(FALLBACK_REMOTE_PATH);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const [pathInput, setPathInput] = useState(FALLBACK_REMOTE_PATH);
  const [listingView, setListingView] = useState<ListingView | null>(null);
  const [listPhase, setListPhase] = useState<ListPhase>("idle");
  const [listPhaseTargetKey, setListPhaseTargetKey] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [capabilityView, setCapabilityView] = useState<CapabilityView | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [operation, setOperation] = useState<Operation>(null);
  const operationRef = useRef<Operation>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const pendingTransferRef = useRef<PendingTransfer | null>(null);
  pendingTransferRef.current = pendingTransfer;
  const [transferPhase, setTransferPhase] = useState<TransferCenterPhase>("review");
  const [transferBatch, setTransferBatch] = useState<FileTransferBatch | null>(null);
  const [transferProgress, setTransferProgress] = useState<FileTransferProgress | null>(null);
  const [selectedConflictKeys, setSelectedConflictKeys] = useState<Set<string>>(() => new Set());
  const transferIdCounter = useRef(0);
  const [entryQuery, setEntryQuery] = useState("");
  const [entryKindFilter, setEntryKindFilter] = useState<"all" | "folders" | "files">("all");
  const [entrySort, setEntrySort] = useState<"name" | "size" | "modified">("name");
  const [entrySortDescending, setEntrySortDescending] = useState(false);
  const [detailsEntry, setDetailsEntry] = useState<DeviceFileEntry | null>(null);

  const listingRequest = useRef(0);
  const capabilityRequest = useRef(0);
  const transferRequest = useRef(0);
  const transferCancelRequestedRef = useRef<string | null>(null);

  const isCurrentTarget = useCallback((expected: TargetSnapshot) => {
    const current = targetRef.current;
    return Boolean(
      current &&
      current.identity === expected.identity &&
      current.serial === expected.serial
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<FileTransferProgress>("file-manager-transfer-progress", (event) => {
      const current = pendingTransferRef.current;
      if (!current || event.payload.transferId !== current.id) return;
      setTransferProgress(event.payload);
      if (event.payload.phase === "cancelled") setTransferPhase("cancelled");
    }).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unlisten = unsubscribe;
    }).catch(() => {
      // The browser-only development surface does not expose the Tauri event bus.
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const requestCapabilities = useCallback(async (expected: TargetSnapshot) => {
    if (!isCurrentTarget(expected)) return null;
    const requestId = ++capabilityRequest.current;
    const key = snapshotKey(expected);
    try {
      const capabilities = await invoke<FileManagerCapabilities>("adb_file_capabilities", {
        deviceSerial: expected.serial,
      });
      if (requestId !== capabilityRequest.current || !isCurrentTarget(expected)) return null;
      setCapabilityView({ targetKey: key, capabilities });
      return capabilities;
    } catch {
      if (requestId !== capabilityRequest.current || !isCurrentTarget(expected)) return null;
      setCapabilityView(null);
      return null;
    }
  }, [isCurrentTarget]);

  const requestDirectory = useCallback(async (
    requestedPath: string,
    options: { append?: boolean; offset?: number; target?: TargetSnapshot } = {},
  ) => {
    const normalized = normalizeRemotePath(requestedPath);
    if (!normalized) {
      setNotice({
        ok: false,
        msg: txRef.current("fileManager.invalidPath", "Enter an absolute device path that starts with /."),
      });
      return;
    }

    const expected = options.target ?? targetRef.current;
    if (!expected) {
      setNotice({
        ok: false,
        msg: txRef.current("deviceTarget.selectOnlineDevice", "Select an online device first."),
      });
      return;
    }
    if (!isCurrentTarget(expected)) return;

    const append = Boolean(options.append);
    const requestId = ++listingRequest.current;
    const key = snapshotKey(expected);
    setListPhaseTargetKey(key);
    setListError(null);
    setListPhase(append ? "loading-more" : "loading");
    if (!append) {
      setCurrentPath(normalized);
      setPathInput(normalized);
      setListingView(null);
      setSelectedPaths(new Set());
    }

    try {
      const page = await invoke<DeviceDirectoryListing>("adb_file_list", {
        deviceSerial: expected.serial,
        path: normalized,
        offset: options.offset ?? 0,
        limit: DIRECTORY_PAGE_SIZE,
      });
      if (requestId !== listingRequest.current || !isCurrentTarget(expected)) return;

      setListingView((current) => {
        if (!append || current?.targetKey !== key || current.listing.path !== page.path) {
          return { targetKey: key, listing: page };
        }
        return {
          targetKey: key,
          listing: {
            ...page,
            offset: current.listing.offset,
            entries: mergeDirectoryEntries(current.listing.entries, page.entries),
          },
        };
      });
      setCurrentPath(page.path);
      setPathInput(page.path);
      setListPhase("ready");
    } catch (error) {
      if (requestId !== listingRequest.current || !isCurrentTarget(expected)) return;
      const detail = normalizeCommandError(error);
      const message = commandErrorMessage(error, txRef.current);
      if (append) {
        setListPhase("ready");
        setNotice({ ok: false, msg: message });
        return;
      }
      setListingView(null);
      setListError(message);
      setListPhase(detail.code === "permission-denied" ? "permission-denied" : "error");
    }
  }, [isCurrentTarget]);

  useEffect(() => {
    const activeTransferId = operationRef.current ? pendingTransferRef.current?.id : null;
    if (activeTransferId) {
      transferCancelRequestedRef.current = activeTransferId;
      void invoke<boolean>("adb_file_cancel_transfer", { transferId: activeTransferId }).catch(() => {
        // The target is already changing; stale transfer results are discarded below.
      });
    }
    listingRequest.current += 1;
    capabilityRequest.current += 1;
    transferRequest.current += 1;
    operationRef.current = null;
    setOperation(null);
    setDragging(false);
    setNotice(null);
    setSelectedPaths(new Set());
    setPendingTransfer(null);
    setTransferPhase("review");
    setTransferBatch(null);
    setTransferProgress(null);
    setSelectedConflictKeys(new Set());
    setListingView(null);
    setCapabilityView(null);
    setListError(null);
    setCurrentPath(FALLBACK_REMOTE_PATH);
    setPathInput(FALLBACK_REMOTE_PATH);

    if (!snapshot) {
      setListPhase("idle");
      setListPhaseTargetKey("");
      return;
    }

    setListPhaseTargetKey(targetKey);
    setListPhase("loading");
    void requestCapabilities(snapshot).then((capabilities) => {
      if (!isCurrentTarget(snapshot)) return;
      const nextPath = capabilities ? initialRemotePath(capabilities) : FALLBACK_REMOTE_PATH;
      void requestDirectory(nextPath, { target: snapshot });
    });
  }, [targetKey, isCurrentTarget, requestCapabilities, requestDirectory]);

  const listing = listingView?.targetKey === targetKey ? listingView.listing : null;
  const capabilities = capabilityView?.targetKey === targetKey ? capabilityView.capabilities : null;
  const visibleListPhase: ListPhase = listPhaseTargetKey === targetKey
    ? listPhase
    : snapshot
      ? "loading"
      : "idle";
  const currentSharedRoot = capabilities ? sharedStorageRoot(capabilities) : null;

  const sortedEntries = useMemo(
    () => sortDirectoryEntries(listing?.entries ?? []),
    [listing?.entries],
  );
  const visibleEntries = useMemo(() => {
    const query = entryQuery.trim().toLocaleLowerCase();
    const filtered = sortedEntries.filter((entry) => {
      if (entryKindFilter === "folders" && entry.kind !== "directory") return false;
      if (entryKindFilter === "files" && entry.kind !== "file") return false;
      if (!query) return true;
      return entry.name.toLocaleLowerCase().includes(query) || entry.path.toLocaleLowerCase().includes(query);
    });
    if (entrySort === "name") return entrySortDescending ? [...filtered].reverse() : filtered;
    return [...filtered].sort((left, right) => {
      const leftValue = entrySort === "size" ? left.sizeBytes : left.modifiedEpochSeconds;
      const rightValue = entrySort === "size" ? right.sizeBytes : right.modifiedEpochSeconds;
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const difference = leftValue - rightValue;
      return entrySortDescending ? -difference : difference;
    });
  }, [entryKindFilter, entryQuery, entrySort, entrySortDescending, sortedEntries]);
  const copyableEntries = useMemo(
    () => sortedEntries.filter(isTransferableDeviceEntry),
    [sortedEntries],
  );
  const visibleCopyableEntries = useMemo(
    () => visibleEntries.filter(isTransferableDeviceEntry),
    [visibleEntries],
  );
  const selectedEntries = useMemo(
    () => copyableEntries.filter((entry) => selectedPaths.has(entry.path)),
    [copyableEntries, selectedPaths],
  );
  const selectedRemotePaths = useMemo(
    () => selectedEntries.map((entry) => entry.path),
    [selectedEntries],
  );
  const selectedRemotePathsRef = useRef(selectedRemotePaths);
  selectedRemotePathsRef.current = selectedRemotePaths;
  const listingRef = useRef<DeviceDirectoryListing | null>(listing);
  listingRef.current = listing;

  const allVisibleSelected = visibleCopyableEntries.length > 0 &&
    visibleCopyableEntries.every((entry) => selectedPaths.has(entry.path));
  const breadcrumbs = useMemo(() => breadcrumbsForRemotePath(currentPath), [currentPath]);

  const quickLocations = useMemo(() => {
    if (!capabilities) return [];
    return capabilities.locations
      .filter((location) => location.exists)
      .map((capability) => ({
        path: capability.path,
        capability,
        ...locationLabel(capability.path, currentSharedRoot),
      }));
  }, [capabilities, currentSharedRoot]);

  const beginOperation = useCallback((next: Exclude<Operation, null>): number | null => {
    if (operationRef.current) return null;
    operationRef.current = next;
    setOperation(next);
    setNotice(null);
    return ++transferRequest.current;
  }, []);

  const finishOperation = useCallback((requestId: number) => {
    if (requestId !== transferRequest.current) return;
    operationRef.current = null;
    setOperation(null);
  }, []);

  const openTransferCenter = useCallback((
    direction: TransferCenterDirection,
    sourcePaths: readonly string[],
    options: { remoteDirectory?: string; localDirectory?: string; destination: string },
  ) => {
    const paths = uniqueExactPaths(sourcePaths);
    if (paths.length === 0) {
      setNotice({
        ok: false,
        msg: tx("fileManager.noSelection", "Select at least one device file or folder."),
      });
      return;
    }
    if (operationRef.current) return;
    const id = `file-transfer-${Date.now()}-${++transferIdCounter.current}`;
    const next: PendingTransfer = {
      id,
      direction,
      sourcePaths: paths,
      remoteDirectory: options.remoteDirectory,
      localDirectory: options.localDirectory,
      destination: options.destination,
    };
    setPendingTransfer(next);
    setTransferPhase("review");
    setTransferBatch(null);
    setTransferProgress(null);
    setSelectedConflictKeys(new Set());
    setNotice(null);
  }, [tx]);

  const pushLocalPaths = useCallback((candidatePaths: readonly string[]) => {
    const expected = targetRef.current;
    if (!expected) {
      setNotice({ ok: false, msg: tx("deviceTarget.selectOnlineDevice", "Select an online device first.") });
      return;
    }
    if (!listingRef.current?.writable) {
      setNotice({ ok: false, msg: tx("fileManager.readOnly", "The current device folder is not writable.") });
      return;
    }
    openTransferCenter("push", candidatePaths, {
      remoteDirectory: currentPathRef.current,
      destination: currentPathRef.current,
    });
  }, [openTransferCenter, tx]);

  const pullRemotePaths = useCallback((remotePaths: readonly string[], localDirectory = "") => {
    const expected = targetRef.current;
    if (!expected || !isCurrentTarget(expected)) return;
    openTransferCenter("pull", remotePaths, {
      localDirectory: localDirectory || undefined,
      destination: localDirectory,
    });
  }, [isCurrentTarget, openTransferCenter]);

  const runPendingTransfer = useCallback(async (
    overwrite: boolean,
    overridePaths?: readonly string[],
  ) => {
    const pending = pendingTransferRef.current;
    const expected = targetRef.current;
    if (!pending || !expected || !isCurrentTarget(expected)) return;
    if (pending.direction === "pull" && !pending.localDirectory) {
      setNotice({ ok: false, msg: tx("fileManager.chooseDestinationFirst", "Choose a computer destination folder first.") });
      return;
    }
    const requestId = beginOperation(pending.direction);
    if (requestId === null) return;
    transferCancelRequestedRef.current = null;
    setTransferPhase("transferring");
    setTransferProgress(null);
    try {
      const paths = uniqueExactPaths(overridePaths ?? pending.sourcePaths);
      let nextBatch: FileTransferBatch;
      if (pending.direction === "push") {
        nextBatch = await invoke<FileTransferBatch>("adb_file_push", {
          deviceSerial: expected.serial,
          localPaths: paths,
          remoteDirectory: pending.remoteDirectory,
          overwrite,
          transferId: pending.id,
        });
      } else {
        nextBatch = await invoke<FileTransferBatch>("adb_file_pull", {
          deviceSerial: expected.serial,
          remotePaths: paths,
          localDirectory: pending.localDirectory,
          overwrite,
          transferId: pending.id,
        });
      }
      if (requestId !== transferRequest.current || !isCurrentTarget(expected)) return;
      const mergedBatch = overwrite && transferBatch
        ? mergeTransferRetry(transferBatch, nextBatch)
        : nextBatch;
      setTransferBatch(mergedBatch);
      if (transferCancelRequestedRef.current === pending.id) {
        setTransferPhase("cancelled");
      } else if (mergedBatch.conflicts > 0) {
        setSelectedConflictKeys(new Set());
        setTransferPhase("conflicts");
      } else {
        setTransferPhase("completed");
      }
      if (pending.direction === "push" && mergedBatch.succeeded > 0 && pending.remoteDirectory && currentPathRef.current === pending.remoteDirectory) {
        void requestDirectory(pending.remoteDirectory, { target: expected });
      }
      setNotice(transferNotice(mergedBatch, tx));
    } catch (error) {
      if (requestId === transferRequest.current && isCurrentTarget(expected)) {
        setNotice({ ok: false, msg: commandErrorMessage(error, tx) });
        setTransferPhase(transferCancelRequestedRef.current === pending.id ? "cancelled" : "review");
      }
    } finally {
      finishOperation(requestId);
      if (transferCancelRequestedRef.current === pending.id) transferCancelRequestedRef.current = null;
    }
  }, [beginOperation, finishOperation, isCurrentTarget, requestDirectory, tx, transferBatch]);

  const handleStartTransfer = useCallback(() => {
    void runPendingTransfer(false);
  }, [runPendingTransfer]);

  const handleCancelTransfer = useCallback(async () => {
    const pending = pendingTransferRef.current;
    if (!pending || transferPhase !== "transferring") return;
    transferCancelRequestedRef.current = pending.id;
    try {
      const cancelled = await invoke<boolean>("adb_file_cancel_transfer", { transferId: pending.id });
      if (!cancelled && transferCancelRequestedRef.current === pending.id) transferCancelRequestedRef.current = null;
    } catch (error) {
      if (transferCancelRequestedRef.current === pending.id) transferCancelRequestedRef.current = null;
      setNotice({ ok: false, msg: commandErrorMessage(error, tx) });
    }
  }, [transferPhase, tx]);

  const handleRetryTransferConflicts = useCallback(() => {
    const pending = pendingTransferRef.current;
    if (!pending || !transferBatch) return;
    const selectedSources = uniqueExactPaths(
      transferBatch.results
        .filter((result) => result.status === "conflict" && selectedConflictKeys.has(transferResultKey(result)))
        .map((result) => result.source),
    );
    if (selectedSources.length === 0) return;
    void runPendingTransfer(true, selectedSources);
  }, [runPendingTransfer, selectedConflictKeys, transferBatch]);

  const closeTransferCenter = useCallback(() => {
    if (transferPhase === "transferring") return;
    setPendingTransfer(null);
    setTransferBatch(null);
    setTransferProgress(null);
    setSelectedConflictKeys(new Set());
    setTransferPhase("review");
  }, [transferPhase]);

  const readHostClipboardAndPush = useCallback(async () => {
    const expected = targetRef.current;
    const remoteDirectory = currentPathRef.current;
    if (!expected) return;
    try {
      const paths = await invoke<string[]>("read_clipboard_local_paths");
      if (!isCurrentTarget(expected) || currentPathRef.current !== remoteDirectory) return;
      await pushLocalPaths(paths);
    } catch (error) {
      if (isCurrentTarget(expected)) {
        setNotice({ ok: false, msg: commandErrorMessage(error, tx) });
      }
    }
  }, [isCurrentTarget, pushLocalPaths, tx]);

  const pushLocalPathsRef = useRef(pushLocalPaths);
  pushLocalPathsRef.current = pushLocalPaths;
  const pasteFromHostRef = useRef(readHostClipboardAndPush);
  pasteFromHostRef.current = readHostClipboardAndPush;

  useEffect(() => {
    if (!active) return;

    const handlePaste = (event: ClipboardEvent) => {
      if (
        isEditableTarget(event.target) ||
        operationRef.current ||
        !targetRef.current ||
        !listingRef.current?.writable
      ) return;
      event.preventDefault();
      void pasteFromHostRef.current();
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(Boolean(
            targetRef.current &&
            listingRef.current?.writable &&
            !operationRef.current
          ));
          return;
        }
        if (payload.type === "drop") {
          setDragging(false);
          if (!targetRef.current || !listingRef.current?.writable || operationRef.current) return;
          void pushLocalPathsRef.current(payload.paths);
          return;
        }
        setDragging(false);
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else unlisten = unsubscribe;
      })
      .catch(() => {
        // Browser-only development does not expose the Tauri drag-drop channel.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active]);

  const navigateTo = useCallback((nextPath: string) => {
    const normalized = normalizeRemotePath(nextPath);
    if (!normalized) {
      setNotice({
        ok: false,
        msg: tx("fileManager.invalidPath", "Enter an absolute device path that starts with /."),
      });
      return;
    }
    setNotice(null);
    void requestDirectory(normalized);
  }, [requestDirectory, tx]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateTo(pathInput);
  };

  const handleChooseFiles = async () => {
    const expected = targetRef.current;
    const remoteDirectory = currentPathRef.current;
    if (!expected) return;
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: tx("fileManager.dialog.chooseFiles", "Choose files to copy to the device"),
      });
      if (
        !selected ||
        !isCurrentTarget(expected) ||
        currentPathRef.current !== remoteDirectory
      ) return;
      await pushLocalPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      if (isCurrentTarget(expected)) {
        setNotice({ ok: false, msg: commandErrorMessage(error, tx) });
      }
    }
  };

  const handleChooseFolder = async () => {
    const expected = targetRef.current;
    const remoteDirectory = currentPathRef.current;
    if (!expected) return;
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: tx("fileManager.dialog.chooseFolder", "Choose a folder to copy to the device"),
      });
      if (
        !selected ||
        !isCurrentTarget(expected) ||
        currentPathRef.current !== remoteDirectory
      ) return;
      await pushLocalPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      if (isCurrentTarget(expected)) {
        setNotice({ ok: false, msg: commandErrorMessage(error, tx) });
      }
    }
  };

  const handleExport = () => {
    const expected = targetRef.current;
    const paths = [...selectedRemotePathsRef.current];
    if (!expected || paths.length === 0) {
      setNotice({ ok: false, msg: tx("fileManager.noSelection", "Select at least one device file or folder.") });
      return;
    }
    pullRemotePaths(paths);
  };

  const chooseTransferDestination = async () => {
    const expected = targetRef.current;
    const pending = pendingTransferRef.current;
    if (!expected || !pending || pending.direction !== "pull") return;
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: tx("fileManager.dialog.exportFolder", "Choose a computer folder for the export"),
      });
      if (!selected || !isCurrentTarget(expected)) return;
      const localDirectory = Array.isArray(selected) ? selected[0] : selected;
      if (!localDirectory) return;
      const next = { ...pending, localDirectory, destination: localDirectory };
      setPendingTransfer(next);
    } catch (error) {
      if (isCurrentTarget(expected)) setNotice({ ok: false, msg: commandErrorMessage(error, tx) });
    }
  };

  const openTransferDestination = () => {
    const pending = pendingTransferRef.current;
    if (pending?.localDirectory) void invoke("reveal_path", { path: pending.localDirectory });
  };

  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLTableRowElement>, entry: DeviceFileEntry) => {
    if (!isTransferableDeviceEntry(entry)) return;
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    if (event.metaKey || event.ctrlKey) {
      togglePath(entry.path);
    } else {
      setSelectedPaths(new Set([entry.path]));
    }
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>, entry: DeviceFileEntry) => {
    if (event.key === "Enter" && isNavigableDeviceEntry(entry)) {
      event.preventDefault();
      navigateTo(entry.path);
    } else if (event.key === "Enter") {
      event.preventDefault();
      setDetailsEntry(entry);
    } else if (event.key === " " && isTransferableDeviceEntry(entry)) {
      event.preventDefault();
      togglePath(entry.path);
    }
  };

  const toggleAllVisible = () => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleCopyableEntries.forEach((entry) => next.delete(entry.path));
      } else {
        visibleCopyableEntries.forEach((entry) => next.add(entry.path));
      }
      return next;
    });
  };

  const canPush = Boolean(snapshot && listing?.writable && !operation);
  const canUseSelection = selectedRemotePaths.length > 0 && Boolean(snapshot) && !operation;
  const busyLabel = operation
    ? tx("fileManager.transferInProgress", "Transferring files…")
    : "";

  return (
    <div className={`file-manager card card-flush${dragging ? " is-dragging" : ""}`}>
      <header className="file-manager-header">
        <SectionTitle
          icon={<FolderIcon size={18} open />}
          label={tx("fileManager.title", "File manager")}
          description={tx(
            "fileManager.description",
            "Browse Android paths and move files between this computer and the selected device.",
          )}
          mb="sm"
        />
        <DeviceTargetBanner target={deviceTarget} />
      </header>

      <main className="file-manager-workspace">
        <div className="file-manager-navigation">
          <div className="file-manager-breadcrumb-row">
            <span className="file-manager-toolbar-label">{tx("fileManager.pathNavigation", "Path navigation")}</span>
            <div className="file-manager-breadcrumb-controls">
              <nav className="file-manager-breadcrumbs" aria-label={tx("fileManager.breadcrumbs", "Device path breadcrumbs")}>
                {breadcrumbs.map((crumb, index) => (
                  <span className="file-manager-breadcrumb" key={crumb.path}>
                    {index > 0 && <SvgIcon size={13}><path d="m9 18 6-6-6-6" /></SvgIcon>}
                    <button
                      type="button"
                      disabled={!snapshot || crumb.path === currentPath}
                      aria-current={crumb.path === currentPath ? "page" : undefined}
                      onClick={() => navigateTo(crumb.path)}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </nav>
              <div className="file-manager-path-actions">
                <button
                  className="btn btn-secondary btn-icon btn-sm"
                  type="button"
                  title={tx("fileManager.parent", "Parent folder")}
                  aria-label={tx("fileManager.parent", "Parent folder")}
                  disabled={!snapshot || currentPath === "/" || visibleListPhase === "loading"}
                  onClick={() => navigateTo(parentRemotePath(currentPath))}
                >
                  <SvgIcon size={17}><path d="m18 15-6-6-6 6" /></SvgIcon>
                </button>
                <button
                  className="btn btn-secondary btn-icon btn-sm"
                  type="button"
                  title={tx("fileManager.refresh", "Refresh folder")}
                  aria-label={tx("fileManager.refresh", "Refresh folder")}
                  disabled={!snapshot || visibleListPhase === "loading" || visibleListPhase === "loading-more"}
                  onClick={() => void requestDirectory(currentPath)}
                >
                  <SvgIcon size={17}><path d="M21 12a9 9 0 0 1-15.17 6.55L3 16" /><path d="M3 21v-5h5" /><path d="M3 12A9 9 0 0 1 18.17 5.45L21 8" /><path d="M16 8h5V3" /></SvgIcon>
                </button>
              </div>
            </div>
          </div>

          <div className="file-manager-quick-row">
            <span className="file-manager-toolbar-label">{tx("fileManager.quickLocations", "Quick locations")}</span>
            <div className="file-manager-quick-paths">
              {quickLocations.map((location) => {
                const disabled = !snapshot || location.capability?.readable === false;
                return (
                  <button
                    type="button"
                    className={`file-manager-quick-chip${currentPath === location.path ? " is-active" : ""}`}
                    key={location.path}
                    disabled={disabled}
                    title={disabled
                      ? tx("fileManager.permissionRestricted", "This path is not readable with the current device access.")
                      : location.path}
                    onClick={() => navigateTo(location.path)}
                  >
                    {location.capability?.readable === false && (
                      <SvgIcon size={13}><rect width="14" height="10" x="5" y="11" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></SvgIcon>
                    )}
                    {tx(`fileManager.locations.${location.key}`, location.fallback)}
                  </button>
                );
              })}
            </div>
          </div>

          <form className="file-manager-path-form" onSubmit={handlePathSubmit}>
            <label htmlFor="file-manager-path">{tx("fileManager.directPath", "Enter device path")}</label>
            <div className="file-manager-path-controls">
              <input
                id="file-manager-path"
                className="input file-manager-path-input"
                value={pathInput}
                disabled={!snapshot}
                spellCheck={false}
                autoComplete="off"
                placeholder={currentSharedRoot ? `${currentSharedRoot}/Download` : FALLBACK_REMOTE_PATH}
                onChange={(event) => setPathInput(event.currentTarget.value)}
              />
              <button className="btn btn-primary btn-sm" type="submit" disabled={!snapshot || visibleListPhase === "loading"}>
                {tx("fileManager.go", "Go")}
              </button>
            </div>
          </form>
        </div>

        <div className="file-manager-transfer-bar">
          <div className="file-manager-transfer-group">
            <span className="file-manager-toolbar-label">{tx("fileManager.toDevice", "Computer → device")}</span>
            <button className="btn btn-secondary btn-sm" type="button" disabled={!canPush} onClick={() => void handleChooseFiles()}>
              <SvgIcon size={16}><path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M5 21h14a2 2 0 0 0 2-2v-4" /><path d="M3 15v4a2 2 0 0 0 2 2" /></SvgIcon>
              {tx("fileManager.chooseFiles", "Choose files")}
            </button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={!canPush} onClick={() => void handleChooseFolder()}>
              <FolderIcon size={16} />
              {tx("fileManager.chooseFolder", "Choose folder")}
            </button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={!canPush} onClick={() => void readHostClipboardAndPush()}>
              <SvgIcon size={16}><rect width="14" height="14" x="5" y="7" rx="2" ry="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></SvgIcon>
              {tx("fileManager.pasteFromComputer", "Paste computer files")}
            </button>
          </div>

          <div className="file-manager-transfer-group is-device-to-host">
            <span className="file-manager-toolbar-label">{tx("fileManager.toComputer", "Device → computer")}</span>
            <button className="btn btn-secondary btn-sm" type="button" disabled={!canUseSelection} onClick={() => void handleExport()}>
              <SvgIcon size={16}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14a2 2 0 0 0 2-2v-4" /><path d="M3 15v4a2 2 0 0 0 2 2" /></SvgIcon>
              {tx("fileManager.exportSelected", "Export to folder")}
            </button>
          </div>
        </div>

        {(notice || busyLabel) && (
          <div className="file-manager-feedback" aria-live="polite">
            {busyLabel && <div className="file-manager-busy"><Spinner />{busyLabel}</div>}
            <ResultAlert result={notice} warning={notice?.warning}>
              {notice?.detail && <div className="file-manager-notice-detail">{notice.detail}</div>}
              {notice?.issues && notice.issues.length > 0 && (
                <details className="file-manager-transfer-issues" open>
                  <summary>{tx(
                    "fileManager.issueDetails",
                    `${notice.issues.length} item(s) need attention`,
                    { count: notice.issues.length },
                  )}</summary>
                  <div className="file-manager-transfer-issue-list">
                    {notice.issues.map((issue, index) => (
                      <div
                        className="file-manager-transfer-issue"
                        key={`${issue.source}\0${issue.destination}\0${index}`}
                      >
                        <span
                          className={`file-manager-transfer-status is-${issue.status}`}
                          title={issue.code ?? issue.status}
                        >
                          {issue.status === "conflict"
                            ? tx("fileManager.conflict", "Conflict")
                            : tx("fileManager.failed", "Failed")}
                        </span>
                        <div className="file-manager-transfer-paths">
                          <code title={issue.source}>{issue.source}</code>
                          <span aria-hidden="true">→</span>
                          <code title={issue.destination}>{issue.destination}</code>
                        </div>
                          <p>{fileTransferResultMessage(issue, tx)}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </ResultAlert>
          </div>
        )}

        <section className="file-manager-browser" aria-label={tx("fileManager.directory", "Device directory") }>
          <div className="file-manager-table-summary">
            <div className="file-manager-table-heading">
              <strong>{tx("fileManager.directory", "Device directory")}</strong>
              <span className="file-manager-table-subtitle">
                <span className="file-manager-table-path" title={currentPath}>{currentPath}</span>
                <span>{listing
                  ? tx("fileManager.itemsLoaded", `${visibleEntries.length} of ${listing.entries.length} item(s) shown`, { count: visibleEntries.length })
                  : tx("fileManager.noItemsLoaded", "No folder loaded")}</span>
              </span>
            </div>
            <span className="file-manager-selection-count">
              {tx("fileManager.selectedCount", `${selectedRemotePaths.length} selected`, { count: selectedRemotePaths.length })}
            </span>
          </div>

          <div className="file-manager-browser-tools">
            <label className="file-manager-search-field">
              <span className="sr-only">{tx("fileManager.search", "Search files")}</span>
              <SvgIcon size={16}><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></SvgIcon>
              <input
                className="input"
                value={entryQuery}
                placeholder={tx("fileManager.searchPlaceholder", "Search this folder")}
                onChange={(event) => setEntryQuery(event.currentTarget.value)}
              />
            </label>
            <select className="input file-manager-filter" value={entryKindFilter} onChange={(event) => setEntryKindFilter(event.currentTarget.value as typeof entryKindFilter)}>
              <option value="all">{tx("fileManager.filterAll", "All items")}</option>
              <option value="folders">{tx("fileManager.filterFolders", "Folders")}</option>
              <option value="files">{tx("fileManager.filterFiles", "Files")}</option>
            </select>
            <select className="input file-manager-sort" value={entrySort} onChange={(event) => setEntrySort(event.currentTarget.value as typeof entrySort)}>
              <option value="name">{tx("fileManager.sortName", "Sort: name")}</option>
              <option value="size">{tx("fileManager.sortSize", "Sort: size")}</option>
              <option value="modified">{tx("fileManager.sortModified", "Sort: modified")}</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-icon btn-sm"
              title={entrySortDescending ? tx("fileManager.sortAscending", "Ascending") : tx("fileManager.sortDescending", "Descending")}
              aria-label={entrySortDescending ? tx("fileManager.sortAscending", "Ascending") : tx("fileManager.sortDescending", "Descending")}
              onClick={() => setEntrySortDescending((current) => !current)}
            >
              <SvgIcon size={16}>{entrySortDescending ? <path d="M12 5v14" /> : <path d="M12 19V5" />}<path d={entrySortDescending ? "m7 14 5 5 5-5" : "m7 10 5-5 5 5"} /></SvgIcon>
            </button>
          </div>

          <div className="file-manager-table-scroll">
            <table className="file-manager-table">
              <colgroup>
                <col className="file-manager-col-check" />
                <col className="file-manager-col-name" />
                <col className="file-manager-col-size" />
                <col className="file-manager-col-modified" />
                <col className="file-manager-col-mode" />
                <col className="file-manager-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">
                    <label className="checkbox file-manager-check">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        disabled={visibleCopyableEntries.length === 0}
                        aria-label={tx("fileManager.selectAll", "Select all loaded files and folders")}
                        onChange={toggleAllVisible}
                      />
                    </label>
                  </th>
                  <th scope="col">{tx("fileManager.name", "Name")}</th>
                  <th scope="col">{tx("fileManager.size", "Size")}</th>
                  <th scope="col">{tx("fileManager.modified", "Modified")}</th>
                  <th scope="col">{tx("fileManager.access", "Permissions")}</th>
                  <th scope="col"><span className="sr-only">{tx("fileManager.details", "Details")}</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const copyable = isTransferableDeviceEntry(entry);
                  const selected = selectedPaths.has(entry.path);
                  return (
                    <tr
                      key={entry.path}
                      className={`${selected ? "is-selected" : ""}${copyable ? " is-copyable" : ""}`}
                      aria-selected={selected}
                      tabIndex={copyable || isNavigableDeviceEntry(entry) ? 0 : -1}
                      onClick={(event) => handleRowClick(event, entry)}
                      onDoubleClick={() => isNavigableDeviceEntry(entry) && navigateTo(entry.path)}
                      onKeyDown={(event) => handleRowKeyDown(event, entry)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setDetailsEntry(entry);
                      }}
                    >
                      <td>
                        <label className="checkbox file-manager-check">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!copyable}
                            aria-label={tx("fileManager.selectItem", `Select ${entry.name}`, { name: entry.name })}
                            onChange={() => togglePath(entry.path)}
                          />
                        </label>
                      </td>
                      <td>
                        <div className="file-manager-entry-name">
                          <span className={`file-manager-kind-icon is-${entry.kind}`}><EntryIcon entry={entry} /></span>
                          <span className="file-manager-entry-text">
                            <span className="file-manager-entry-label">{entry.name}</span>
                            {entry.symlinkTarget && <span className="file-manager-entry-target">→ {entry.symlinkTarget}</span>}
                          </span>
                          {!entry.readable && (
                            <span className="file-manager-locked" title={tx("fileManager.notReadable", "Not readable") }>
                              <SvgIcon size={13}><rect width="14" height="10" x="5" y="11" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></SvgIcon>
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{entry.kind === "directory" ? "—" : formatFileSize(entry.sizeBytes)}</td>
                      <td>{formatModifiedTime(entry.modifiedEpochSeconds, i18n.resolvedLanguage)}</td>
                      <td>
                        <span className="file-manager-mode">{entry.mode ?? "—"}</span>
                        <span className="file-manager-access-flags" aria-label={tx(
                          "fileManager.itemAccess",
                          `${entry.readable ? "readable" : "not readable"}, ${entry.writable ? "writable" : "not writable"}`,
                          {
                            readable: entry.readable
                              ? tx("fileManager.readable", "Readable")
                              : tx("fileManager.notReadable", "Not readable"),
                            writable: entry.writable
                              ? tx("fileManager.writable", "Writable")
                              : tx("fileManager.readOnly", "Read-only"),
                          },
                        )}>
                          {entry.readable ? "R" : "–"}{entry.writable ? "W" : "–"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon btn-sm file-manager-details-button"
                          title={tx("fileManager.details", "Details")}
                          aria-label={tx("fileManager.detailsFor", `Details for ${entry.name}`, { name: entry.name })}
                          onClick={() => setDetailsEntry(entry)}
                        >
                          <SvgIcon size={15}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7h.01" /></SvgIcon>
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {visibleListPhase === "loading" && (
                  <tr className="file-manager-state-row"><td colSpan={6}><Spinner />{tx("fileManager.loading", "Loading device folder…")}</td></tr>
                )}
                {visibleListPhase === "idle" && (
                  <tr className="file-manager-state-row"><td colSpan={6}>{tx("fileManager.selectDevice", "Select an online device to browse its files.")}</td></tr>
                )}
                {visibleListPhase === "permission-denied" && (
                    <tr className="file-manager-state-row is-permission"><td colSpan={6}>
                    <strong>{tx("fileManager.permissionTitle", "Android blocked this folder")}</strong>
                    <span>{listError ?? tx("fileManager.permissionDenied", "The current ADB identity cannot open this path.")}</span>
                    {currentPath !== "/" && (
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigateTo(parentRemotePath(currentPath))}>
                        {tx("fileManager.openParent", "Open parent folder")}
                      </button>
                    )}
                  </td></tr>
                )}
                {visibleListPhase === "error" && (
                    <tr className="file-manager-state-row is-error"><td colSpan={6}>
                    <strong>{tx("fileManager.errorTitle", "Folder could not be loaded")}</strong>
                    <span>{listError}</span>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => void requestDirectory(currentPath)}>
                      {tx("fileManager.tryAgain", "Try again")}
                    </button>
                  </td></tr>
                )}
                {visibleListPhase === "ready" && visibleEntries.length === 0 && (
                  <tr className="file-manager-state-row"><td colSpan={6}>{listing && listing.entries.length > 0 && (entryQuery || entryKindFilter !== "all")
                    ? tx("fileManager.noMatchingItems", "No items match this filter.")
                    : tx("fileManager.empty", "This folder is empty.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className="file-manager-pagination">
            <span>{listing
              ? listing.writable
                ? tx("fileManager.readWrite", "This folder accepts files from the computer.")
                : tx("fileManager.readOnly", "This folder is read-only for the current ADB user.")
              : visibleListPhase === "loading"
                ? tx("fileManager.loading", "Loading folder…")
                : tx("fileManager.unavailable", "No device folder is available.")}</span>
            {listing?.hasMore && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={visibleListPhase === "loading-more"}
                onClick={() => void requestDirectory(listing.path, {
                  append: true,
                  offset: listing.nextOffset,
                })}
              >
                {visibleListPhase === "loading-more" && <Spinner />}
                {visibleListPhase === "loading-more"
                  ? tx("fileManager.loadingMore", "Loading more…")
                  : tx("fileManager.loadMore", "Load more")}
              </button>
            )}
          </footer>
        </section>
      </main>

      {dragging && (
        <div className="file-manager-drop-overlay" aria-live="polite">
          <FolderIcon size={28} open />
          <strong>{tx("fileManager.dropHint", "Drop to copy to this device folder", { path: currentPath })}</strong>
          <span>{currentPath}</span>
        </div>
      )}

      <FileTransferDrawer
        open={Boolean(pendingTransfer)}
        phase={transferPhase}
        direction={pendingTransfer?.direction ?? "push"}
        sourcePaths={pendingTransfer?.sourcePaths ?? []}
        destination={pendingTransfer?.destination ?? ""}
        batch={transferBatch}
        progress={transferProgress}
        selectedConflictKeys={selectedConflictKeys}
        onToggleConflict={(key) => setSelectedConflictKeys((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })}
        onChooseDestination={pendingTransfer?.direction === "pull" ? () => void chooseTransferDestination() : undefined}
        onStart={handleStartTransfer}
        onCancel={() => void handleCancelTransfer()}
        onRetryConflicts={handleRetryTransferConflicts}
        onOpenDestination={pendingTransfer?.localDirectory ? openTransferDestination : undefined}
        onClose={closeTransferCenter}
        tx={tx}
      />

      <FileDetailsDrawer
        entry={detailsEntry}
        locale={i18n.resolvedLanguage}
        onClose={() => setDetailsEntry(null)}
        tx={tx}
      />
    </div>
  );
}
