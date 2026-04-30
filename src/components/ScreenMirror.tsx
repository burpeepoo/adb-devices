import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  deviceSerial: string | null;
  onMirrorStateChange: (deviceSerial: string | null) => void;
}

interface MirrorState {
  running: boolean;
  device_serial: string | null;
}

export default function ScreenMirror({ deviceSerial, onMirrorStateChange }: Props) {
  const [scrcpyAvailable, setScrcpyAvailable] = useState<boolean | null>(null);
  const [installingScrcpy, setInstallingScrcpy] = useState(false);
  const [installProgress, setInstallProgress] = useState<string[]>([]);
  const [mirroring, setMirroring] = useState(false);
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [navigationLoading, setNavigationLoading] = useState<"back" | "home" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const applyMirrorState = useCallback(
    (state: MirrorState) => {
      setMirroring(state.running);
      onMirrorStateChange(state.running ? state.device_serial : null);
    },
    [onMirrorStateChange]
  );

  const syncMirrorState = useCallback(async () => {
    const state = await invoke<MirrorState>("get_screen_mirror_state");
    applyMirrorState(state);
    return state;
  }, [applyMirrorState]);

  useEffect(() => {
    invoke<boolean>("check_scrcpy_available")
      .then(setScrcpyAvailable)
      .catch(() => setScrcpyAvailable(false));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("scrcpy-install-progress", (event) => {
      setInstallProgress((current) => [...current.slice(-9), event.payload]);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    syncMirrorState().catch(() => {
      applyMirrorState({ running: false, device_serial: null });
    });
    const timer = setInterval(() => {
      syncMirrorState().catch(() => {
        applyMirrorState({ running: false, device_serial: null });
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [applyMirrorState, syncMirrorState]);

  const handleInstallScrcpy = async () => {
    if (installingScrcpy) return;
    setInstallingScrcpy(true);
    setStatus(null);
    setInstallProgress(["开始安装 scrcpy"]);
    try {
      const msg = await invoke<string>("install_scrcpy");
      setScrcpyAvailable(true);
      setStatus({ ok: true, msg });
    } catch (e) {
      setScrcpyAvailable(false);
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setInstallingScrcpy(false);
    }
  };

  const handleStartMirror = async () => {
    if (!deviceSerial || mirrorLoading) return;
    setMirrorLoading(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("start_screen_mirror", {
        deviceSerial,
      });
      await syncMirrorState();
      setStatus({ ok: true, msg });
    } catch (e) {
      syncMirrorState().catch(() => {
        applyMirrorState({ running: false, device_serial: null });
      });
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setMirrorLoading(false);
    }
  };

  const handleNavigationKey = async (key: "back" | "home") => {
    if (!deviceSerial || navigationLoading) return;
    setNavigationLoading(key);
    setStatus(null);
    try {
      const msg = await invoke<string>("send_navigation_key", {
        deviceSerial,
        key,
      });
      setStatus({ ok: true, msg });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setNavigationLoading(null);
    }
  };

  const handleStopMirror = async () => {
    if (mirrorLoading) return;
    setMirrorLoading(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("stop_screen_mirror");
      await syncMirrorState();
      setStatus({ ok: true, msg });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setMirrorLoading(false);
    }
  };

  const handleOpenExternalUrl = async (url: string) => {
    try {
      await invoke("open_external_url", { url });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    }
  };

  if (scrcpyAvailable === null) {
    return (
      <div className="max-w-3xl space-y-4">
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-800">投屏控制</h3>
          <div className="mt-3 text-sm text-gray-500">正在检测 scrcpy...</div>
        </section>
      </div>
    );
  }

  if (!scrcpyAvailable) {
    return (
      <div className="max-w-3xl space-y-4">
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-800">投屏控制</h3>
          <p className="text-sm text-gray-500 mt-2">
            投屏控制需要 scrcpy。macOS 会自动检测并安装 Homebrew 后执行 brew install scrcpy；Windows 会自动下载
            scrcpy 并安装到本地应用目录。
          </p>

          <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div className="font-medium text-amber-800">温馨提示</div>
            <p>
              macOS 投屏需要 Homebrew 和 scrcpy，Windows 投屏需要 scrcpy。下面的一键安装会尽量自动完成；如果安装失败，请打开官方页面，按官方最新指令手动安装后再返回本页。
            </p>
            <div className="space-y-1">
              <div>
                <span>Homebrew 官方: </span>
                <button
                  type="button"
                  onClick={() => handleOpenExternalUrl("https://brew.sh/")}
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  https://brew.sh/
                </button>
              </div>
              <div>
                <span>scrcpy 官方: </span>
                <button
                  type="button"
                  onClick={() => handleOpenExternalUrl("https://github.com/Genymobile/scrcpy")}
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  https://github.com/Genymobile/scrcpy
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleInstallScrcpy}
            disabled={installingScrcpy}
            className="mt-4 w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {installingScrcpy ? "正在安装..." : "一键安装 scrcpy"}
          </button>

          {(installingScrcpy || installProgress.length > 0) && (
            <div className="mt-3 text-left text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
              {installProgress.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          )}

          {status && (
            <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {status.msg}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">投屏控制</h3>
            <p className="text-xs text-gray-400 mt-1">通过 scrcpy 打开可交互投屏窗口</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartMirror}
              disabled={!deviceSerial || mirroring || mirrorLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mirrorLoading && !mirroring ? "启动中..." : "开始投屏"}
            </button>
            <button
              onClick={handleStopMirror}
              disabled={!mirroring || mirrorLoading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:bg-red-200 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
            >
              {mirrorLoading && mirroring ? "关闭中..." : "停止投屏"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500">返回 / Home 控制</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleNavigationKey("back")}
                disabled={!deviceSerial || Boolean(navigationLoading)}
                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {navigationLoading === "back" ? "发送中..." : "返回"}
              </button>
              <button
                type="button"
                onClick={() => handleNavigationKey("home")}
                disabled={!deviceSerial || Boolean(navigationLoading)}
                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {navigationLoading === "home" ? "发送中..." : "Home"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="font-medium text-blue-800">scrcpy 右键</div>
                <div className="mt-0.5 text-blue-600">等同返回</div>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="font-medium text-blue-800">scrcpy 中键</div>
                <div className="mt-0.5 text-blue-600">等同 Home</div>
              </div>
            </div>
          </div>
        </div>

        {installProgress.length > 0 && (
          <div className="mt-3 text-left text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
            {installProgress.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        )}

        {status && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {status.msg}
          </div>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">请先选择在线设备</div>
        )}
      </section>

      <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-medium text-gray-600 mb-1">说明</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>- 投屏窗口由 scrcpy 提供，可以直接用鼠标和键盘操作设备</li>
          <li>- 返回和 Home 可以点上方按钮，也可以直接在 scrcpy 窗口里右键或中键操作</li>
          <li>- 截图和录屏请使用顶部独立的截图、录屏页面</li>
        </ul>
      </section>
    </div>
  );
}
