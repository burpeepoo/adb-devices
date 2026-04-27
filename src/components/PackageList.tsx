import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PackageInfo } from "../types";

interface Props {
  deviceSerial: string | null;
}

export default function PackageList({ deviceSerial }: Props) {
  const [packages, setPackages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [pkgInfo, setPkgInfo] = useState<PackageInfo | null>(null);
  const [pkgLoading, setPkgLoading] = useState(false);

  const handleList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<string[]>("adb_list_packages", {
        deviceSerial: deviceSerial || null,
      });
      setPackages(result);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, [deviceSerial]);

  const handleSelectPackage = useCallback(
    async (pkg: string) => {
      setSelectedPkg(pkg);
      setPkgLoading(true);
      try {
        const info = await invoke<PackageInfo>("adb_package_info", {
          packageName: pkg,
          deviceSerial: deviceSerial || null,
        });
        setPkgInfo(info);
      } catch {
        setPkgInfo(null);
      } finally {
        setPkgLoading(false);
      }
    },
    [deviceSerial]
  );

  const filtered = search
    ? packages.filter((p) => p.toLowerCase().includes(search.toLowerCase()))
    : packages;

  return (
    <div className="flex gap-4 h-full">
      {/* Package list */}
      <div className="w-80 bg-white rounded-lg border border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <div className="flex gap-2 mb-2">
            <button
              onClick={handleList}
              disabled={loading || !deviceSerial}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "加载中..." : "获取包列表"}
            </button>
          </div>
          {packages.length > 0 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索包名..."
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {filtered.map((pkg) => (
            <button
              key={pkg}
              onClick={() => handleSelectPackage(pkg)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                selectedPkg === pkg ? "bg-blue-50 text-blue-700" : "text-gray-700"
              }`}
            >
              {pkg}
            </button>
          ))}
          {packages.length === 0 && !loading && (
            <div className="p-4 text-center text-sm text-gray-400">
              点击"获取包列表"加载
            </div>
          )}
        </div>

        {packages.length > 0 && (
          <div className="p-2 border-t border-gray-200 text-xs text-gray-400 text-center">
            共 {filtered.length} 个包
          </div>
        )}
      </div>

      {/* Package detail */}
      <div className="flex-1 bg-white rounded-lg border border-gray-200 p-5">
        {selectedPkg ? (
          pkgLoading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : pkgInfo ? (
            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-4">包详情</h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-gray-500">包名</dt>
                  <dd className="text-sm text-gray-800 font-mono">{pkgInfo.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">版本名称 (Version Name)</dt>
                  <dd className="text-sm text-gray-800">{pkgInfo.version_name || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">版本号 (Version Code)</dt>
                  <dd className="text-sm text-gray-800">{pkgInfo.version_code || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Build ID</dt>
                  <dd className="text-sm text-gray-800">{pkgInfo.build_id || "-"}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">无法获取包信息</div>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            选择一个包查看详情
          </div>
        )}
      </div>
    </div>
  );
}
