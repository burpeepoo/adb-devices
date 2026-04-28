import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  deviceSerial: string | null;
}

const MAX_LENGTH = 2000;

export default function Clipboard({ deviceSerial }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setResult(null);
    try {
      const msg = await invoke<string>("adb_input_text", {
        text,
        deviceSerial: deviceSerial || null,
      });
      setResult({ ok: true, msg });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">剪贴板</h3>
          <span className={`text-xs ${text.length >= MAX_LENGTH ? "text-red-500" : "text-gray-400"}`}>
            {text.length}/{MAX_LENGTH}
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          maxLength={MAX_LENGTH}
          rows={5}
          placeholder="输入或粘贴要发送到设备当前输入框的文本"
          className="w-full min-h-[120px] resize-y px-3 py-2 border border-gray-300 rounded-lg text-sm leading-6 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? "发送中..." : "粘贴到设备"}
          </button>
          <button
            onClick={() => {
              setText("");
              setResult(null);
            }}
            disabled={!text && !result}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            清空
          </button>
        </div>

        {result && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {result.msg}
          </div>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            未选择设备，将使用默认设备
          </div>
        )}
      </section>
    </div>
  );
}
