import assert from "node:assert/strict";
import test from "node:test";
import { rewriteAdbShellBatch } from "../src/workbenchCommandRewrite.ts";

test("rewrites multiple adb shell lines into one selected-device shell command", () => {
  const result = rewriteAdbShellBatch(`
adb -s 192.168.110.131:42933 shell getprop ro.serialno
adb shell wm size
shell settings get global adb_enabled
`);

  assert.deepEqual(result, {
    ok: true,
    command: "shell 'getprop ro.serialno; wm size; settings get global adb_enabled'",
    count: 3,
  });
});

test("skips blank lines and comments while rewriting shell commands", () => {
  const result = rewriteAdbShellBatch(`
# device diagnostics

adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'
shell getprop ro.product.model
`);

  assert.deepEqual(result, {
    ok: true,
    command: "shell 'dumpsys window | grep -E '\\''mCurrentFocus|mFocusedApp'\\''; getprop ro.product.model'",
    count: 2,
  });
});

test("does not rewrite unsupported non-shell adb commands", () => {
  const result = rewriteAdbShellBatch(`
adb shell getprop ro.serialno
adb install -r /tmp/app.apk
`);

  assert.deepEqual(result, {
    ok: false,
    reason: "unsupported",
    line: 3,
    command: "adb install -r /tmp/app.apk",
  });
});

test("returns empty when no shell commands are present", () => {
  assert.deepEqual(rewriteAdbShellBatch("\n# nothing here\n"), {
    ok: false,
    reason: "empty",
  });
});
