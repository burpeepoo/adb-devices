import assert from "node:assert/strict";
import test from "node:test";
import { extractClipboardPaths, isLikelyLocalPath } from "../src/pathClipboard.ts";

test("extracts full local paths from newline text", () => {
  assert.deepEqual(extractClipboardPaths("/Users/kai/Downloads/app.apk\n"), ["/Users/kai/Downloads/app.apk"]);
});

test("decodes file uri paths without reducing to basename", () => {
  assert.deepEqual(
    extractClipboardPaths("file:///Users/kai/Downloads/My%20Build/app.apk"),
    ["/Users/kai/Downloads/My Build/app.apk"],
  );
});

test("identifies absolute local paths", () => {
  assert.equal(isLikelyLocalPath("/Users/kai/Downloads/app.apk"), true);
  assert.equal(isLikelyLocalPath("~/Downloads/app.apk"), true);
  assert.equal(isLikelyLocalPath("C:\\Users\\Kai\\Downloads\\app.apk"), true);
  assert.equal(isLikelyLocalPath("app.apk"), false);
});
