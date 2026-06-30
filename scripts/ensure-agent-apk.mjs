import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APK = path.join(ROOT, "src-tauri/resources/agent/adb-manager-agent.apk");
const AGENT_ROOT = path.join(ROOT, "agent-android");
const BUILD_SCRIPT = path.join(AGENT_ROOT, "build-agent-apk.sh");

const apkExists = existsSync(APK);
const canBuild = process.platform !== "win32" && existsSync(BUILD_SCRIPT) && hasAndroidBuildTools() && hasWorkingJdk();
const stale = apkExists && sourceMtime(AGENT_ROOT) > statSync(APK).mtimeMs;

if (!apkExists && !canBuild) {
  console.error("Agent APK is missing and this environment cannot build it.");
  console.error("Expected:", path.relative(ROOT, APK));
  console.error("Install Android SDK build-tools and a JDK, then run: npm run build:agent");
  process.exit(1);
}

if (canBuild && (!apkExists || stale)) {
  console.log(`Building bundled Agent APK${stale ? " because source changed" : ""}...`);
  const result = spawnSync("bash", [BUILD_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

console.log(`Bundled Agent APK ready: ${path.relative(ROOT, APK)}`);

function hasAndroidBuildTools() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultAndroidSdk();
  if (!sdk) return false;
  const buildTools = path.join(sdk, "build-tools");
  try {
    return readdirSync(buildTools).some((version) =>
      ["aapt2", "d8", "apksigner", "zipalign"].every((binary) =>
        existsSync(path.join(buildTools, version, binary)),
      ),
    );
  } catch {
    return false;
  }
}

function hasWorkingJdk() {
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "javac") : null,
    "/opt/homebrew/opt/openjdk@17/bin/javac",
    "/usr/local/opt/openjdk@17/bin/javac",
    "/opt/homebrew/opt/openjdk/bin/javac",
    "/usr/local/opt/openjdk/bin/javac",
    "javac",
  ].filter(Boolean);

  return candidates.some((candidate) => {
    const result = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    return result.status === 0;
  });
}

function defaultAndroidSdk() {
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library/Android/sdk");
  }
  return null;
}

function sourceMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "build") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, sourceMtime(fullPath));
    } else {
      newest = Math.max(newest, statSync(fullPath).mtimeMs);
    }
  }
  return newest;
}
