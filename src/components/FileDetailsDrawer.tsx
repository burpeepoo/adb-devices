import {
  formatFileSize,
  formatModifiedTime,
  type DeviceFileEntry,
} from "../fileManagerModel.ts";
import type { TranslateFileManager } from "./FileTransferDrawer";

interface Props {
  entry: DeviceFileEntry | null;
  locale?: string;
  onClose: () => void;
  tx: TranslateFileManager;
}

function kindLabel(entry: DeviceFileEntry, tx: TranslateFileManager): string {
  switch (entry.kind) {
    case "directory": return tx("fileManager.folder", "Folder");
    case "symlink": return tx("fileManager.symlink", "Symbolic link");
    case "other": return tx("fileManager.specialFile", "Special file");
    default: return tx("fileManager.file", "File");
  }
}

export default function FileDetailsDrawer({ entry, locale, onClose, tx }: Props) {
  if (!entry) return null;
  return (
    <div className="file-details-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="file-details-drawer" role="dialog" aria-modal="true" aria-labelledby="file-details-drawer-title">
        <header className="file-details-drawer-header">
          <div>
            <h2 id="file-details-drawer-title">{entry.name}</h2>
          </div>
          <button type="button" className="file-transfer-drawer-close" onClick={onClose} aria-label={tx("fileManager.closeTransferCenter", "Close")}>
            ×
          </button>
        </header>
        <div className="file-details-drawer-body">
          <div className="file-details-drawer-kind">{kindLabel(entry, tx)}</div>
          <dl className="file-details-list">
            <div><dt>{tx("fileManager.path", "Path")}</dt><dd title={entry.path}>{entry.path}</dd></div>
            <div><dt>{tx("fileManager.size", "Size")}</dt><dd>{entry.kind === "directory" ? "—" : formatFileSize(entry.sizeBytes)}</dd></div>
            <div><dt>{tx("fileManager.modified", "Modified")}</dt><dd>{formatModifiedTime(entry.modifiedEpochSeconds, locale)}</dd></div>
            <div><dt>{tx("fileManager.access", "Access")}</dt><dd>{entry.readable ? tx("fileManager.readable", "Readable") : tx("fileManager.notReadable", "Not readable")} · {entry.writable ? tx("fileManager.writable", "Writable") : tx("fileManager.readOnly", "Read-only")}</dd></div>
            <div><dt>{tx("fileManager.mode", "Mode")}</dt><dd>{entry.mode ?? "—"}</dd></div>
            {entry.symlinkTarget && <div><dt>{tx("fileManager.target", "Target")}</dt><dd title={entry.symlinkTarget}>{entry.symlinkTarget}</dd></div>}
          </dl>
          <p className="file-details-drawer-note">
            {tx("fileManager.detailsReadOnly", "Details are read-only. Remote preview and editing are not enabled in this file manager.")}
          </p>
        </div>
        <footer className="file-transfer-drawer-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>{tx("fileManager.closeTransferCenter", "Close")}</button>
        </footer>
      </aside>
    </div>
  );
}
