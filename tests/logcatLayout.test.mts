import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logcatPath = new URL("../src/components/Logcat.tsx", import.meta.url);
const logcatCssPath = new URL("../src/components/Logcat.css", import.meta.url);

test("logcat uses the Marque tool surface instead of legacy utility cards", () => {
  const source = readFileSync(logcatPath, "utf8");
  const css = readFileSync(logcatCssPath, "utf8");

  assert.match(source, /import "\.\/Logcat\.css"/);
  assert.match(source, /className="logcat-panel"/);
  assert.match(source, /className="logcat-filters"/);
  assert.match(source, /className="logcat-console"/);
  assert.doesNotMatch(source, /bg-white|rounded-lg border border-gray-200|bg-blue-600|focus:ring-blue-500|text-gray-500/);

  assert.match(css, /\.logcat-action\.is-primary/);
  assert.match(css, /\.logcat-row/);
  assert.match(css, /var\(--color-indigo\)/);
  assert.doesNotMatch(css, /blue-600|gray-200|#2563eb|#1d4ed8/);
});
