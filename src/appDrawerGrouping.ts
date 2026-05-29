import type { LaunchableApp } from "./types";

export interface AppDrawerGroup {
  key: string;
  title: string;
  apps: LaunchableApp[];
}

function appDrawerCategoryKey(packageName: string) {
  const parts = packageName
    .split(".")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const namespace = parts[0] === "com" && parts[1] ? parts[1] : parts[0];
  if (!namespace) return "other";
  if (namespace === "elclcd") return "cozyla";
  return namespace;
}

function titleCaseCategory(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function sortLaunchableApps(apps: LaunchableApp[]) {
  return apps.slice().sort((a, b) => {
    return (
      a.label.localeCompare(b.label) ||
      a.package_name.localeCompare(b.package_name) ||
      a.activity_name.localeCompare(b.activity_name)
    );
  });
}

export function groupLaunchableApps(apps: LaunchableApp[]): AppDrawerGroup[] {
  const groups = new Map<string, LaunchableApp[]>();

  for (const app of sortLaunchableApps(apps)) {
    const key = appDrawerCategoryKey(app.package_name);
    const groupApps = groups.get(key) ?? [];
    groupApps.push(app);
    groups.set(key, groupApps);
  }

  return Array.from(groups.entries())
    .map(([key, groupApps]) => ({
      key,
      title: titleCaseCategory(key),
      apps: groupApps,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
