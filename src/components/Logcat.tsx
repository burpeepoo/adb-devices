import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  deviceSerial: string | null;
}

const MAX_LINES = 3000;

export default function Logcat({ deviceSerial }: Props) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("adb-logcat-line", (event) => {
      setLines((prev) => {
        const next = [...prev, event.payload];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (runningRef.current) {
        invoke("adb_stop_logcat").catch(() => {
          // The process may already have exited.
        });
      }
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  const logText = useMemo(() => lines.join("\n"), [lines]);

  const handleStart = async () => {
    if (running) return;
    setStatus(null);
    try {
      const msg = await invoke<string>("adb_start_logcat", {
        deviceSerial: deviceSerial || null,
      });
      runningRef.current = true;
      setRunning(true);
      setStatus({ ok: true, msg });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    }
  };

  const handleStop = async () => {
    setStatus(null);
    try {
      const msg = await invoke<string>("adb_stop_logcat");
      runningRef.current = false;
      setRunning(false);
      setStatus({ ok: true, msg });
    } catch (e) {
      runningRef.current = false;
      setRunning(false);
      setStatus({ ok: false, msg: String(e) });
    }
  };

  const handleExport = async () => {
    if (!logText || exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const savedPath = await invoke<string | null>("export_text_file", {
        defaultName: `logcat_${timestamp}.txt`,
        content: logText,
      });
      if (savedPath) {
        setStatus({ ok: true, msg: `已导出到 ${savedPath}` });
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">ADB Logcat</h3>
            <p className="text-xs text-gray-400 mt-1">
              {running ? "正在实时读取日志" : "点击查看后才会开始连接设备读取日志"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!running ? (
              <button
                onClick={handleStart}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                查看 logcat
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                关闭
              </button>
            )}
            <button
              onClick={() => {
                setLines([]);
                setStatus(null);
              }}
              disabled={lines.length === 0}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              清空
            </button>
            <button
              onClick={handleExport}
              disabled={!logText || exporting}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? "导出中..." : "导出"}
            </button>
          </div>
        </div>

        <div
          ref={logRef}
          className="h-[520px] overflow-auto rounded-lg bg-gray-950 px-3 py-2 font-mono text-xs leading-5 text-gray-100 border border-gray-800"
        >
          {lines.length > 0 ? (
            lines.map((line, index) => <div key={`${index}-${line.slice(0, 16)}`}>{line}</div>)
          ) : (
            <div className="text-gray-500">暂无日志</div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          <span>保留最近 {MAX_LINES} 行</span>
          <span>{lines.length} 行</span>
        </div>

        {status && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {status.msg}
          </div>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            未选择设备，将使用默认设备读取 logcat
          </div>
        )}
      </section>
    </div>
  );
}
