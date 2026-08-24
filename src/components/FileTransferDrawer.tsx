import {
  fileTransferResultMessage,
  type FileTransferBatch,
  type FileTransferProgress,
  type FileTransferResult,
} from "../fileManagerModel.ts";

export type TransferCenterPhase = "review" | "transferring" | "conflicts" | "completed" | "cancelled";
export type TransferCenterDirection = "push" | "pull";
export type TranslateFileManager = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

export interface FileTransferDrawerProps {
  open: boolean;
  phase: TransferCenterPhase;
  direction: TransferCenterDirection;
  sourcePaths: readonly string[];
  destination: string;
  batch: FileTransferBatch | null;
  progress: FileTransferProgress | null;
  selectedConflictKeys: ReadonlySet<string>;
  onToggleConflict: (key: string) => void;
  onChooseDestination?: () => void;
  onStart: () => void;
  onCancel: () => void;
  onRetryConflicts: () => void;
  onOpenDestination?: () => void;
  onClose: () => void;
  tx: TranslateFileManager;
}

function resultKey(result: FileTransferResult): string {
  return `${result.source}\0${result.destination}`;
}

function displayName(path: string): string {
  const normalized = path.replace(/[\\/]$/, "");
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) || path : path;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(result: FileTransferResult, tx: TranslateFileManager): string {
  switch (result.status) {
    case "success": return tx("fileManager.completed", "Completed");
    case "conflict": return tx("fileManager.conflict", "Conflict");
    default: return tx("fileManager.failed", "Failed");
  }
}

function progressMessage(progress: FileTransferProgress | null, tx: TranslateFileManager): string {
  switch (progress?.phase) {
    case "transferring": return tx("fileManager.transferringItem", "Transferring current item…");
    case "item-processed": return tx("fileManager.itemProcessed", "Processed current item.");
    case "completed": return tx("fileManager.transferComplete", "Transfer completed.");
    case "cancelled": return tx("fileManager.transferCancelled", "Transfer cancelled.");
    default: return tx("fileManager.preparingTransfer", "Preparing transfer…");
  }
}

export default function FileTransferDrawer({
  open,
  phase,
  direction,
  sourcePaths,
  destination,
  batch,
  progress,
  selectedConflictKeys,
  onToggleConflict,
  onChooseDestination,
  onStart,
  onCancel,
  onRetryConflicts,
  onOpenDestination,
  onClose,
  tx,
}: FileTransferDrawerProps) {
  if (!open) return null;

  const conflictResults = batch?.results.filter((result) => result.status === "conflict") ?? [];
  const resultItems = batch?.results ?? [];
  const progressValue = progress && progress.totalItems > 0
    ? Math.min(100, Math.round((progress.processedItems / progress.totalItems) * 100))
    : 0;
  const isBusy = phase === "transferring";
  const canStart = direction !== "pull" || Boolean(destination);
  const selectedConflicts = conflictResults.filter((result) => selectedConflictKeys.has(resultKey(result)));
  const title = direction === "push"
    ? tx("fileManager.transferToDevice", "Transfer to device")
    : tx("fileManager.transferToComputer", "Transfer to computer");

  return (
    <div className="file-transfer-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isBusy) onClose();
    }}>
      <aside
        className="file-transfer-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-transfer-drawer-title"
      >
        <header className="file-transfer-drawer-header">
          <div>
            <h2 id="file-transfer-drawer-title">{title}</h2>
          </div>
          <button
            type="button"
            className="file-transfer-drawer-close"
            onClick={onClose}
            disabled={isBusy}
            aria-label={tx("fileManager.closeTransferCenter", "Close")}
          >
            ×
          </button>
        </header>

        <div className="file-transfer-drawer-body">
          <section className="file-transfer-drawer-summary" aria-label={tx("fileManager.transferSummaryLabel", "Transfer summary")}>
            <div>
              <span>{tx("fileManager.sources", "Sources")}</span>
              <strong>{sourcePaths.length}</strong>
            </div>
            <div className="file-transfer-drawer-summary-destination">
              <span>{tx("fileManager.destination", "Destination")}</span>
              <code title={destination || tx("fileManager.destinationPending", "Choose a destination") }>
                {destination || tx("fileManager.destinationPending", "Choose a destination")}
              </code>
            </div>
          </section>

          {phase === "review" && (
            <section className="file-transfer-drawer-section">
              <div className="file-transfer-drawer-section-heading">
                <div>
                  <h3>{tx("fileManager.reviewTransfer", "Review before transfer")}</h3>
                  <p>{tx("fileManager.reviewTransferHint", "Nothing is copied until you confirm this list.")}</p>
                </div>
                {direction === "pull" && onChooseDestination && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onChooseDestination}>
                    {tx("fileManager.chooseDestination", "Choose folder")}
                  </button>
                )}
              </div>
              <div className="file-transfer-drawer-source-list">
                {sourcePaths.map((path) => (
                  <div className="file-transfer-drawer-source" key={path}>
                    <span className="file-transfer-drawer-source-mark" aria-hidden="true">•</span>
                    <span title={path}>{displayName(path)}</span>
                    <code title={path}>{path}</code>
                  </div>
                ))}
              </div>
            </section>
          )}

          {isBusy && (
            <section className="file-transfer-drawer-section is-progress" aria-live="polite">
              <div className="file-transfer-drawer-progress-heading">
                <div>
                  <h3>{tx("fileManager.transferInProgress", "Transferring files…")}</h3>
                  <p>{progressMessage(progress, tx)}</p>
                </div>
                <strong>{progressValue}%</strong>
              </div>
              <div className="file-transfer-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
                <span style={{ width: `${progressValue}%` }} />
              </div>
              <div className="file-transfer-drawer-progress-meta">
                <span>
                  {progress
                    ? tx("fileManager.progressItems", `${progress.processedItems} / ${progress.totalItems} items processed`, {
                      processed: progress.processedItems,
                      total: progress.totalItems,
                    })
                    : tx("fileManager.preparingTransfer", "Preparing transfer…")}
                </span>
                <span>{formatElapsed(progress?.elapsedMs ?? 0)}</span>
              </div>
              {progress?.currentSource && (
                <div className="file-transfer-drawer-current">
                  <span>{tx("fileManager.currentItem", "Current item")}</span>
                  <code title={progress.currentSource}>{progress.currentSource}</code>
                  {progress.currentDestination && (
                    <code title={progress.currentDestination}>{progress.currentDestination}</code>
                  )}
                </div>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
                {tx("fileManager.cancelTransfer", "Cancel transfer")}
              </button>
            </section>
          )}

          {phase === "conflicts" && conflictResults.length > 0 && (
            <section className="file-transfer-drawer-section is-conflicts">
              <div className="file-transfer-drawer-section-heading">
                <div>
                  <h3>{tx("fileManager.conflictTitle", "Items already exist")}</h3>
                  <p>{tx("fileManager.conflictSelectionHint", "Choose exactly which destinations may be replaced.")}</p>
                </div>
                <span className="file-transfer-drawer-count">{selectedConflicts.length} / {conflictResults.length}</span>
              </div>
              <div className="file-transfer-drawer-conflict-list">
                {conflictResults.map((result) => {
                  const key = resultKey(result);
                  return (
                    <label className="file-transfer-drawer-conflict" key={key}>
                      <input
                        type="checkbox"
                        checked={selectedConflictKeys.has(key)}
                        onChange={() => onToggleConflict(key)}
                      />
                      <span>
                        <strong>{displayName(result.source)}</strong>
                        <code title={result.destination}>{result.destination}</code>
                      </span>
                    </label>
                  );
                })}
              </div>
              {conflictResults.some((result) => result.itemKind === "directory") && (
                <p className="file-transfer-drawer-warning">
                  {tx("fileManager.directoryReplaceWarning", "A conflicting folder is replaced as one complete item. Files that exist only in the old destination folder are removed.")}
                </p>
              )}
              {batch && batch.results.some((result) => result.status !== "conflict") && (
                <div className="file-transfer-drawer-result-list" aria-label={tx("fileManager.transferResults", "Transfer results")}>
                  {batch.results.filter((result) => result.status !== "conflict").map((result) => (
                    <div className="file-transfer-drawer-result" key={resultKey(result)}>
                      <span className={`file-manager-transfer-status is-${result.status}`}>{statusLabel(result, tx)}</span>
                      <div>
                        <code title={result.source}>{result.source}</code>
                        <span aria-hidden="true">→</span>
                        <code title={result.destination}>{result.destination}</code>
                        <p>{fileTransferResultMessage(result, tx)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {phase === "completed" || phase === "cancelled" ? (
            <section className="file-transfer-drawer-section is-results" aria-live="polite">
              <div className="file-transfer-drawer-result-summary">
                <strong>{batch ? tx("fileManager.transferSummary", `${batch.succeeded} completed · ${batch.conflicts} conflicts · ${batch.failed} failed`, {
                  succeeded: batch.succeeded,
                  conflicts: batch.conflicts,
                  failed: batch.failed,
                }) : tx("fileManager.transferCancelled", "Transfer cancelled")}</strong>
                <span>{phase === "cancelled" ? tx("fileManager.transferCancelledHint", "Completed items were kept; the remaining items were not started.") : tx("fileManager.transferCompleteHint", "The transfer result is recorded below.")}</span>
              </div>
              {resultItems.length > 0 && (
                <div className="file-transfer-drawer-result-list">
                  {resultItems.map((result) => (
                    <div className="file-transfer-drawer-result" key={resultKey(result)}>
                      <span className={`file-manager-transfer-status is-${result.status}`}>{statusLabel(result, tx)}</span>
                      <div>
                        <code title={result.source}>{result.source}</code>
                        <span aria-hidden="true">→</span>
                        <code title={result.destination}>{result.destination}</code>
                        <p>{fileTransferResultMessage(result, tx)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>

        <footer className="file-transfer-drawer-footer">
          {phase === "review" && (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {tx("fileManager.cancel", "Cancel")}
              </button>
              <button type="button" className="btn btn-primary" disabled={!canStart} onClick={onStart}>
                {tx("fileManager.startTransfer", "Start transfer")}
              </button>
            </>
          )}
          {phase === "conflicts" && (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {tx("fileManager.cancel", "Cancel")}
              </button>
              <button type="button" className="btn btn-primary" disabled={selectedConflicts.length === 0} onClick={onRetryConflicts}>
                {tx("fileManager.replaceSelected", "Replace selected")}
              </button>
            </>
          )}
          {(phase === "completed" || phase === "cancelled") && (
            <>
              {onOpenDestination && phase === "completed" && (
                <button type="button" className="btn btn-secondary" onClick={onOpenDestination}>
                  {tx("fileManager.openDestination", "Open destination")}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onClose}>
                {tx("fileManager.closeTransferCenter", "Close")}
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
