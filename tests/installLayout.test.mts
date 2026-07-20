import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("APK install keeps the whole page scrollable while the queue stays bounded", () => {
  const source = readFileSync(new URL("../src/components/ApkInstall.tsx", import.meta.url), "utf8");

  assert.match(source, /apk-install-page/);
  assert.match(source, /apk-install-card/);
  assert.match(source, /apk-install-card flex min-w-0 shrink-0 flex-col overflow-hidden/);
  assert.match(source, /apk-install-queue-panel/);
  assert.match(source, /apk-install-queue-list/);
  assert.match(source, /apk-install-action-bar/);
  assert.match(source, /h-44 min-w-0 overflow-auto/);
  assert.match(source, /h-24 min-h-24 min-w-0 flex-1/);
  assert.match(source, /overflow-hidden rounded-lg border border-gray-200/);
  assert.match(source, /flex min-w-0 min-h-0 flex-none flex-col/);
  assert.match(source, /flex h-full w-full min-w-0 flex-col .*overflow-hidden/);
  assert.match(source, /apk-install-action-bar shrink-0/);
  assert.doesNotMatch(source, /sticky bottom-0/);
  assert.doesNotMatch(source, /DeviceTargetBanner/);
  assert.match(source, /overflow-y-auto overflow-x-hidden/);
  assert.match(source, /pb-3/);
  assert.match(source, /installSelected/);
});
