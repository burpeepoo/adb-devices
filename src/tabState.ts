import type { TabKey } from "./types";

export const TAB_KEYS: TabKey[] = [
  "pair",
  "workbench",
  "agent",
  "install",
  "screenshot",
  "record",
  "mirror",
  "remote",
  "imageCast",
  "clipboard",
  "logcat",
  "displayCalibration",
  "performance",
  "packages",
];

export function markTabVisited(current: ReadonlySet<TabKey>, tab: TabKey): Set<TabKey> {
  if (current.has(tab)) {
    return new Set(current);
  }

  const next = new Set(current);
  next.add(tab);
  return next;
}

export function primaryTabKey(): TabKey {
  return "pair";
}

export function tabKeyFromValue(value?: string | null): TabKey | null {
  if (!value) return null;
  const normalized = value.replace(/^#/, "").trim();
  const tabParam = normalized.startsWith("tab=") ? normalized.slice(4) : normalized;
  return TAB_KEYS.includes(tabParam as TabKey) ? (tabParam as TabKey) : null;
}

export function initialTabKeyFrom(hash?: string | null, override?: string | null): TabKey {
  return tabKeyFromValue(override) ?? tabKeyFromValue(hash) ?? primaryTabKey();
}

export function hashForTab(tab: TabKey): string {
  return `#${tab}`;
}
