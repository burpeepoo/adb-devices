import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatDuration } from "../utils/format";

interface Props {
  deviceSerial: string | null;
  saveDir: string;
  onSaveDirChange: (dir: string) => void;
}

export default function ScreenRecord({ deviceSerial, saveDir, onSaveDirChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recording]);

  const handleStart = useCallback(async () => {
    if (!deviceSerial) {
      setResult({ ok: false, msg: "请先选择设备" });
      return;
    }
    try {
      await invoke<string>("adb_start_recording", {
        deviceSerial: deviceSerial || null,
      });
      setRecording(true);
      setElapsed(0);
      setResult(null);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  }, [deviceSerial]);

  const handleStop = useCallback(async () => {
    if (!saveDir) {
      setResult({ ok: false, msg: "请先在设置中配置录屏保存目录" });
      return;
    }
    setStopping(true);
    try {
      const path = await invoke<string>("adb_stop_recording", {
        saveDir,
        deviceSerial: deviceSerial || null,
      });
      setLastPath(path);
      setResult({ ok: true, msg: `录屏已保存到: ${path}` });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setRecording(false);
      setStopping(false);
    }
  }, [saveDir, deviceSerial]);

  const handleSelectSaveDir = useCallback(async () => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        onSaveDirChange(dir);
        setResult({ ok: true, msg: `录屏保存目录已修改为: ${dir}` });
      }
    } catch {
      setResult({ ok: false, msg: "无法修改录屏保存目录" });
    }
  }, [onSaveDirChange]);

  // Warning at 2:45 (165 seconds)
  const showWarning = recording && elapsed >= 165;

  return (
    <div className="max-w-xl space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-4">设备录屏</h3>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">保存目录</label>
          <div className="flex gap-2">
            <div className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-gray-50 truncate">
              {saveDir || "未设置"}
            </div>
            <button
              onClick={handleSelectSaveDir}
              disabled={recording}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              修改目录
            </button>
          </div>
        </div>

        {/* Timer display */}
        {recording && (
          <div className="mb-4 text-center">
            <div className="inline-flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-2xl font-mono font-bold text-red-700">{formatDuration(elapsed)}</span>
            </div>
            {showWarning && (
              <div className="mt-2 text-sm text-amber-600">
                录屏即将达到 3 分钟上限，设备将自动停止
              </div>
            )}
          </div>
        )}

        {/* Start / Stop buttons */}
        {!recording ? (
          <button
            onClick={handleStart}
            disabled={!deviceSerial}
            className="w-full py-3 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
            </svg>
            开始录屏
          </button>
        ) : (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="w-full py-3 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            {stopping ? "停止中..." : "停止录屏"}
          </button>
        )}

        {result && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {result.msg}
          </div>
        )}

        {lastPath && result?.ok && (
          <button
            onClick={async () => {
              try {
                await invoke("reveal_path", { path: lastPath });
              } catch {
                setResult({ ok: false, msg: "无法打开文件夹，请手动前往保存目录查看" });
              }
            }}
            className="mt-2 text-xs text-blue-500 hover:text-blue-700"
          >
            在文件夹中显示
          </button>
        )}

        {!deviceSerial && !recording && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            请先选择设备
          </div>
        )}
      </section>

      {/* Info */}
      <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-medium text-gray-600 mb-1">说明</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>- 设备录屏最长 <strong>3 分钟</strong>（Android 系统限制）</li>
          <li>- 录屏文件格式为 MP4</li>
          <li>- 点击"停止录屏"后文件将自动保存到本地</li>
        </ul>
      </section>
    </div>
  );
}
