import type { TabKey } from "./types";

export const TAB_KEYS: TabKey[] = [
  "pair",
  "workbench",
  "install",
  "screenshot",
  "record",
  "mirror",
  "remote",
  "imageCast",
  "clipboard",
  "logcat",
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
