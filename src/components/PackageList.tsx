import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PackageInfo } from "../types";

interface Props {
  deviceSerial: string | null;
}

type SortKey = "name" | "version_name" | "version_code" | "device_serial" | "build_number";
type SortDirection = "asc" | "desc";

export default function PackageList({ deviceSerial }: Props) {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<PackageInfo[]>("adb_list_package_details", {
        deviceSerial: deviceSerial || null,
      });
      setPackages(result);
    } catch (e) {
      setPackages([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [deviceSerial]);

  const filtered = search
    ? packages.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : packages;
  const sorted = [...filtered].sort((a, b) => {
    const aValue = a[sortKey] || "";
    const bValue = b[sortKey] || "";
    const result = aValue.localeCompare(bValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return sortDirection === "asc" ? result : -result;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  const handleCopyPackageName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setError(null);
    } catch {
      setError("复制包名失败");
    }
  };

  return (
    <div className="h-full bg-white rounded-lg border border-gray-200 flex flex-col">
      <div className="p-3 border-b border-gray-200">
        <div className="flex gap-2 mb-2">
          <button
            onClick={handleList}
            disabled={loading || !deviceSerial}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "加载中..." : "获取包信息"}
          </button>
          {packages.length > 0 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索包名..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          )}
        </div>
        {error && (
          <div className="text-sm px-3 py-2 rounded-lg bg-red-50 text-red-600">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {sorted.length > 0 ? (
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("name")} className="hover:text-gray-800">
                    包名{sortIndicator("name")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("version_name")} className="hover:text-gray-800">
                    Version Name{sortIndicator("version_name")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("version_code")} className="hover:text-gray-800">
                    Version Code{sortIndicator("version_code")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("device_serial")} className="hover:text-gray-800">
                    Serial Number{sortIndicator("device_serial")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("build_number")} className="hover:text-gray-800">
                    Build Number{sortIndicator("build_number")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pkg) => (
                <tr key={pkg.name} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-gray-800">{pkg.name}</td>
                  <td className="px-3 py-2 text-gray-700">{pkg.version_name || "-"}</td>
                  <td className="px-3 py-2 text-gray-700">{pkg.version_code || "-"}</td>
                  <td className="px-3 py-2 text-gray-700">{pkg.device_serial || "-"}</td>
                  <td className="px-3 py-2 text-gray-700">{pkg.build_number || "-"}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => handleCopyPackageName(pkg.name)}
                      className="text-blue-500 hover:text-blue-700"
                    >
                      复制包名
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && (
            <div className="p-6 text-center text-sm text-gray-400">
              {deviceSerial ? "点击获取包信息加载" : "请先选择在线设备"}
            </div>
          )
        )}
      </div>

      {packages.length > 0 && (
        <div className="p-2 border-t border-gray-200 text-xs text-gray-400 text-center">
          共 {sorted.length} / {packages.length} 个包
        </div>
      )}
    </div>
  );
}
