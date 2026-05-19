import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { rankedPackages } from "../utils/packageSearch";

interface Props {
  value: string;
  onChange: (value: string) => void;
  deviceSerial: string | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  packages?: string[];
  loadingPackages?: boolean;
  onLoadPackages?: () => Promise<void> | void;
  onSelectPackage?: (value: string) => void;
  suggestionLimit?: number;
}

export default function PackageNameInput({
  value,
  onChange,
  deviceSerial,
  disabled = false,
  placeholder,
  className,
  packages,
  loadingPackages,
  onLoadPackages,
  onSelectPackage,
  suggestionLimit = 30,
}: Props) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [internalPackages, setInternalPackages] = useState<string[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);

  const availablePackages = packages ?? internalPackages;
  const isLoading = loadingPackages ?? internalLoading;
  const showSuggestions = focused && value.trim().length >= 2;

  const suggestions = useMemo(
    () => (showSuggestions ? rankedPackages(availablePackages, value, suggestionLimit) : []),
    [availablePackages, showSuggestions, suggestionLimit, value],
  );

  const loadPackages = async () => {
    if (isLoading || availablePackages.length > 0) return;

    if (onLoadPackages) {
      await onLoadPackages();
      return;
    }

    setInternalLoading(true);
    try {
      const loaded = await invoke<string[]>("adb_list_packages", {
        deviceSerial: deviceSerial || null,
      });
      setInternalPackages(loaded);
    } catch {
      setInternalPackages([]);
    } finally {
      setInternalLoading(false);
    }
  };

  const handleSelect = (pkg: string) => {
    onChange(pkg);
    onSelectPackage?.(pkg);
    setFocused(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          setFocused(true);
          void loadPackages();
        }}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        disabled={disabled}
        placeholder={placeholder}
        className={
          className ??
          "w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        }
      />
      {showSuggestions && (
        <div className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {isLoading && <div className="px-2 py-1.5 text-xs text-gray-400">{t("apkInstall.loading")}</div>}
          {!isLoading &&
            suggestions.map((pkg) => (
              <button
                key={pkg}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(pkg)}
                className="w-full px-2 py-1.5 text-left font-mono text-xs text-gray-700 hover:bg-blue-50"
              >
                {pkg}
              </button>
            ))}
          {!isLoading && availablePackages.length > 0 && suggestions.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-gray-400">{t("apkInstall.noMatch")}</div>
          )}
        </div>
      )}
    </div>
  );
}
