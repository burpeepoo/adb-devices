import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  deviceSerial: string | null;
  recentApkDir: string;
  onRecentApkDirChange: (dir: string) => void;
}

export default function ApkInstall({ deviceSerial, recentApkDir, onRecentApkDirChange }: Props) {
  const [apkPath, setApkPath] = useState("");
  const [force, setForce] = useState(false);
  const [pkgName, setPkgName] = useState("");
  const [pkgSearch, setPkgSearch] = useState("");
  const [installedPackages, setInstalledPackages] = useState<string[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSelectApk = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "APK", extensions: ["apk"] }],
      title: "选择 APK 文件",
      defaultPath: recentApkDir || undefined,
    });
    if (selected) {
      const selectedPath = selected as string;
      setApkPath(selectedPath);
      setResult(null);
      const separator = selectedPath.includes("\\") ? "\\" : "/";
      const parentDir = selectedPath.slice(0, selectedPath.lastIndexOf(separator));
      if (parentDir) {
        onRecentApkDirChange(parentDir);
      }

      try {
        const parsedPkg = await invoke<string>("parse_apk_package", {
          apkPath: selectedPath,
        });
        setPkgName(parsedPkg);
      } catch {
        setPkgName("");
        setResult({ ok: false, msg: "未能自动识别包名，强制安装时请手动填写" });
      }
    }
  };

  const handleInstall = async () => {
    if (!apkPath) return;
    if (force && !pkgName.trim()) {
      setResult({ ok: false, msg: "强制安装需要输入包名" });
      return;
    }
    setInstalling(true);
    setResult(null);
    try {
      const msg = await invoke<string>("adb_install", {
        apkPath,
        force,
        pkgName: force ? pkgName.trim() : null,
        deviceSerial: deviceSerial || null,
      });
      setResult({ ok: true, msg });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setInstalling(false);
    }
  };

  const handleLoadPackages = async () => {
    setLoadingPackages(true);
    setResult(null);
    try {
      const packages = await invoke<string[]>("adb_list_packages", {
        deviceSerial: deviceSerial || null,
      });
      setInstalledPackages(packages);
      setPkgSearch(pkgName);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoadingPackages(false);
    }
  };

  const filteredPackages = pkgSearch
    ? installedPackages.filter((pkg) => pkg.toLowerCase().includes(pkgSearch.toLowerCase()))
    : installedPackages;

  return (
    <div className="max-w-xl space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-4">安装 APK</h3>

        {/* APK selection */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">APK 文件</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={apkPath}
              readOnly
              placeholder="请选择 APK 文件"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
            />
            <button
              onClick={handleSelectApk}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              选择文件
            </button>
          </div>
        </div>

        {/* Force install option */}
        <div className="mb-4 space-y-3">
          {pkgName && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">识别到的包名</label>
              <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50 font-mono">
                {pkgName}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">强制安装（先卸载旧版本再安装）</span>
          </label>

          {force && (
            <div className="space-y-2">
              <label className="block text-xs text-gray-500 mb-1">包名 (Package Name)</label>
              <input
                type="text"
                value={pkgName}
                onChange={(e) => {
                  setPkgName(e.target.value);
                  setPkgSearch(e.target.value);
                }}
                placeholder="com.example.app"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleLoadPackages}
                  disabled={loadingPackages}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 disabled:opacity-50"
                >
                  {loadingPackages ? "加载中..." : "从已安装包中选择"}
                </button>
                {installedPackages.length > 0 && (
                  <span className="text-xs text-gray-400">输入关键词搜索后点击包名选择</span>
                )}
              </div>
              {installedPackages.length > 0 && (
                <div className="max-h-36 overflow-auto border border-gray-200 rounded-lg bg-white">
                  {filteredPackages.slice(0, 80).map((pkg) => (
                    <button
                      key={pkg}
                      onClick={() => {
                        setPkgName(pkg);
                        setPkgSearch(pkg);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-blue-50"
                    >
                      {pkg}
                    </button>
                  ))}
                  {filteredPackages.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">没有匹配的包名</div>
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-400">强制安装会先卸载该包名，再安装当前 APK</p>
            </div>
          )}
        </div>

        {/* Install button */}
        <button
          onClick={handleInstall}
          disabled={installing || !apkPath}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {installing ? "安装中..." : "安装"}
        </button>

        {result && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {result.msg}
          </div>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            未选择设备，将使用默认设备安装
          </div>
        )}
      </section>

      {/* Info */}
      <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-medium text-gray-600 mb-1">说明</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>- 默认使用覆盖安装模式（保留数据），如需清除数据请勾选"强制安装"</li>
          <li>- 强制安装会先卸载旧版本（数据会丢失），再安装新版本</li>
          <li>- 安装可能需要设备上确认安装权限</li>
        </ul>
      </section>
    </div>
  );
}
