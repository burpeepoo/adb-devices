import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings } from "../types";

interface Props {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

export default function Settings({ settings, onSettingsChange, onClose }: Props) {
  const [local, setLocal] = useState(settings);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const handleSelectDir = async (type: "screenshotDir" | "recordingDir") => {
    try {
      const dir = await invoke<Option<string>>("select_directory");
      if (dir) {
        const newSettings = { ...local, [type]: dir };
        setLocal(newSettings);
      }
    } catch {
      // user cancelled
    }
  };

  const handleSave = () => {
    onSettingsChange(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">设置</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Screenshot dir */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">截图保存目录</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.screenshotDir}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
              />
              <button
                onClick={() => handleSelectDir("screenshotDir")}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                选择
              </button>
            </div>
          </div>

          {/* Recording dir */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">录屏保存目录</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.recordingDir}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
              />
              <button
                onClick={() => handleSelectDir("recordingDir")}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                选择
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

type Option<T> = T | null;
