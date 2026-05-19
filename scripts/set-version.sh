#!/bin/bash
# Update every app version field used by npm, Tauri, and Cargo.
set -euo pipefail

cd "$(dirname "$0")/.."

raw_version="${1:-}"
if [[ -z "$raw_version" ]]; then
    echo "Usage: $0 <version>" >&2
    echo "Example: $0 1.0.0" >&2
    exit 1
fi

VERSION="${raw_version#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
    echo "Error: version must look like 1.0.0 or v1.0.0, got: $raw_version" >&2
    exit 1
fi

node - "$VERSION" <<'NODE'
const fs = require("fs");
const version = process.argv[2];

function updateJson(path, updater) {
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  updater(data);
  fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

updateJson("package.json", (data) => {
  data.version = version;
});

updateJson("package-lock.json", (data) => {
  data.version = version;
  if (data.packages && data.packages[""]) {
    data.packages[""].version = version;
  }
});

updateJson("src-tauri/tauri.conf.json", (data) => {
  data.version = version;
});

function updateFirstPackageVersion(path) {
  const text = fs.readFileSync(path, "utf8");
  const packageHeader = text.indexOf("[package]");
  if (packageHeader === -1) {
    throw new Error(`${path}: missing [package] section`);
  }
  const nextHeader = text.indexOf("\n[", packageHeader + "[package]".length);
  const before = text.slice(0, packageHeader);
  const section = text.slice(packageHeader, nextHeader === -1 ? text.length : nextHeader);
  const after = nextHeader === -1 ? "" : text.slice(nextHeader);
  if (!/^version = ".*"$/m.test(section)) {
    throw new Error(`${path}: missing version in [package] section`);
  }
  fs.writeFileSync(path, before + section.replace(/^version = ".*"$/m, `version = "${version}"`) + after);
}

updateFirstPackageVersion("src-tauri/Cargo.toml");
updateFirstPackageVersion("src-tauri/Cargo.lock");
NODE

echo "Updated app version to ${VERSION}"
