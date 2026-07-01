import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("APK install keeps the install action reachable while long queues scroll", () => {
  const source = readFileSync(new URL("../src/components/ApkInstall.tsx", import.meta.url), "utf8");

  assert.match(source, /apk-install-page/);
  assert.match(source, /apk-install-card/);
  assert.match(source, /apk-install-queue-panel/);
  assert.match(source, /apk-install-queue-list/);
  assert.match(source, /apk-install-action-bar/);
  assert.match(source, /sticky bottom-0/);
  assert.match(source, /overflow-y-auto overflow-x-hidden/);
  assert.match(source, /pb-3/);
  assert.match(source, /installSelected/);
});
