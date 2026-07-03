import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings uses the Cirrus app shell layout and colors", () => {
  const source = readFileSync(new URL("../src/components/Settings.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(source, /settings-shell/);
  assert.match(source, /settings-rail/);
  assert.match(source, /settings-workspace/);
  assert.match(source, /settings-content/);
  assert.match(source, /settings-section-card/);
  assert.match(source, /background: "var\(--surface-page\)"/);
  assert.match(source, /background: "var\(--color-cloud\)"/);
  assert.match(source, /borderRadius: "var\(--radius-xl\)"/);
  assert.match(source, /boxShadow: "var\(--shadow-tier-1\)"/);
  assert.match(source, /background: active \? "var\(--color-ink\)"/);
  assert.doesNotMatch(source, /#111827/);
  assert.doesNotMatch(source, /mantine-color-gray-0/);
  assert.match(source, /settings\.sectionAgent/);
  assert.match(source, /settings\.sectionFiles/);
  assert.match(source, /settings\.sectionUpdates/);
  assert.match(zh.settings.sectionAgent, /Agent/);
  assert.match(en.settings.sectionUpdates, /Updates/);
});
