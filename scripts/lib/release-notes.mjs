import fs from "node:fs";
import path from "node:path";

function normalizeVersion(version) {
  return version.replace(/^v/, "");
}

function relative(root, filePath) {
  return path.relative(root, filePath) || path.basename(filePath);
}

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8").trim();
  return content ? content : null;
}

function extractChangelogSection(changelog, version) {
  const normalized = normalizeVersion(version);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    return new RegExp(`^##\\s+\\[?v?${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?\\b`).test(line);
  });
  if (start === -1) return null;

  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines.slice(start + 1, next === -1 ? lines.length : next).join("\n").trim() || null;
}

function cleanMarkdown(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s+/, "").replace(/^\s*[-*]\s+/, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readReleaseNotes({ root = process.cwd(), version, explicitPath }) {
  const normalized = normalizeVersion(version);
  const candidates = [
    explicitPath,
    process.env.UPDATER_RELEASE_NOTES_FILE,
    path.join(root, "release-notes", `v${normalized}.txt`),
    path.join(root, "release-notes", `${normalized}.txt`),
    path.join(root, "release-notes", `v${normalized}.md`),
    path.join(root, "release-notes", `${normalized}.md`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const filePath = path.isAbsolute(candidate) ? candidate : path.join(root, candidate);
    const notes = readIfExists(filePath);
    if (notes) {
      return {
        notes: filePath.endsWith(".md") ? cleanMarkdown(notes) : notes,
        source: relative(root, filePath),
      };
    }
  }

  const changelogPath = path.join(root, "CHANGELOG.md");
  const changelog = readIfExists(changelogPath);
  if (changelog) {
    const notes = extractChangelogSection(changelog, normalized);
    if (notes) {
      return {
        notes: cleanMarkdown(notes),
        source: "CHANGELOG.md",
      };
    }
  }

  return {
    notes: `ADB Manager v${normalized}`,
    source: "default",
  };
}
