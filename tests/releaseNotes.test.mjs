import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readReleaseNotes } from "../scripts/lib/release-notes.mjs";

function withTempProject(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-release-notes-"));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("reads bilingual release notes file for updater notes", () => {
  withTempProject((root) => {
    fs.mkdirSync(path.join(root, "release-notes"));
    fs.writeFileSync(
      path.join(root, "release-notes", "v1.2.3.md"),
      "## English\n\n- Added update dots.\n\n## 中文\n\n- 增加更新红点。\n"
    );

    const result = readReleaseNotes({ root, version: "1.2.3" });

    assert.equal(result.source, "release-notes/v1.2.3.md");
    assert.match(result.notes, /## English/);
    assert.match(result.notes, /## 中文/);
  });
});

test("falls back to the matching changelog section", () => {
  withTempProject((root) => {
    fs.writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [1.2.3] - 2026-05-21\n\n### Added\n\n- Added updater notes.\n\n## [1.2.2] - 2026-05-20\n\n- Old entry.\n"
    );

    const result = readReleaseNotes({ root, version: "1.2.3" });

    assert.equal(result.source, "CHANGELOG.md");
    assert.match(result.notes, /### Added/);
    assert.match(result.notes, /Added updater notes/);
    assert.doesNotMatch(result.notes, /Old entry/);
  });
});
