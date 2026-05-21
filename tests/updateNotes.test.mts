import assert from "node:assert/strict";
import test from "node:test";
import { selectUpdateNoteBody } from "../src/updateNotes.ts";

test("selects English notes for English UI", () => {
  const body = "en-US: New update dot and automatic checks.\nzh-CN: 新增更新红点和自动检查。";

  assert.equal(selectUpdateNoteBody(body, "en-US"), "New update dot and automatic checks.");
});

test("selects Chinese notes for Chinese UI", () => {
  const body = "en-US: New update dot and automatic checks.\nzh-CN: 新增更新红点和自动检查。";

  assert.equal(selectUpdateNoteBody(body, "zh-CN"), "新增更新红点和自动检查。");
});

test("keeps old markdown notes readable while selecting the current language", () => {
  const body = "## English\n\n- New update dot.\n\n## 中文\n\n- 新增更新红点。";

  assert.equal(selectUpdateNoteBody(body, "zh-CN"), "新增更新红点。");
});
