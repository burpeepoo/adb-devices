#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.GITHUB_REPOSITORY || "burpeepoo/adb-devices";
const ROOT = process.cwd();
const VERSION = (process.argv[2] || "").replace(/^v/, "");
const OUTPUT_DIR = path.join(ROOT, "src-tauri/target/release/bundle/updater");

if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(VERSION)) {
  console.error("Usage: node scripts/generate-updater-json.mjs <version>");
  console.error("Example: node scripts/generate-updater-json.mjs 1.2.3");
  process.exit(1);
}

const releaseBaseUrl = `https://github.com/${REPO}/releases/download/v${VERSION}`;

const searchRoots = [
  OUTPUT_DIR,
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos",
  "src-tauri/target/x86_64-apple-darwin/release/bundle/macos",
  "src-tauri/target/release/bundle/nsis",
  "src-tauri/target/release/bundle/msi",
].map((entry) => (path.isAbsolute(entry) ? entry : path.join(ROOT, entry)));

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

const allFiles = searchRoots.flatMap(listFiles);

function findRequired(description, predicate) {
  const found = allFiles.find(predicate);
  if (!found) {
    throw new Error(`Missing ${description}. Search roots:\n${searchRoots.map((root) => `- ${root}`).join("\n")}`);
  }
  return found;
}

function copyAsset(source, assetName) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const destination = path.join(OUTPUT_DIR, assetName);
  if (path.resolve(source) !== path.resolve(destination)) {
    fs.copyFileSync(source, destination);
  }
  return destination;
}

function readSignature(sigPath) {
  return fs.readFileSync(sigPath, "utf8").trim();
}

function macSource(targetTriple, normalizedName) {
  return findRequired(`${targetTriple} updater bundle`, (file) => {
    return (
      path.basename(file) === normalizedName ||
      (file.includes(path.join("target", targetTriple, "release", "bundle", "macos")) &&
        path.basename(file) === "ADB Manager.app.tar.gz")
    );
  });
}

function windowsSource() {
  return findRequired("Windows NSIS updater installer", (file) => {
    const name = path.basename(file);
    return name.endsWith(".exe") && name.includes(VERSION) && name.toLowerCase().includes("setup");
  });
}

const assets = {
  "darwin-aarch64": {
    assetName: `ADB_Manager_${VERSION}_aarch64.app.tar.gz`,
  },
  "darwin-x86_64": {
    assetName: `ADB_Manager_${VERSION}_x64.app.tar.gz`,
  },
  "windows-x86_64": {
    source: windowsSource(),
    assetName: `ADB.Manager_${VERSION}_x64-setup.exe`,
  },
};

assets["darwin-aarch64"].source = macSource("aarch64-apple-darwin", assets["darwin-aarch64"].assetName);
assets["darwin-x86_64"].source = macSource("x86_64-apple-darwin", assets["darwin-x86_64"].assetName);

const platforms = Object.fromEntries(
  Object.entries(assets).map(([platform, asset]) => {
    const artifact = copyAsset(asset.source, asset.assetName);
    const sourceSig = `${asset.source}.sig`;
    const signatureSource = fs.existsSync(sourceSig)
      ? sourceSig
      : findRequired(`${asset.assetName}.sig`, (file) => path.basename(file) === `${asset.assetName}.sig`);
    const sigAsset = copyAsset(signatureSource, `${asset.assetName}.sig`);

    return [
      platform,
      {
        signature: readSignature(sigAsset),
        url: `${releaseBaseUrl}/${encodeURIComponent(asset.assetName)}`,
      },
    ];
  })
);

const latest = {
  version: VERSION,
  notes: `ADB Manager v${VERSION}`,
  pub_date: new Date().toISOString(),
  platforms,
};

const outputPath = path.join(OUTPUT_DIR, "latest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(latest, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
Object.values(assets).forEach((asset) => {
  console.log(`Prepared ${path.join(OUTPUT_DIR, asset.assetName)}`);
  console.log(`Prepared ${path.join(OUTPUT_DIR, `${asset.assetName}.sig`)}`);
});
