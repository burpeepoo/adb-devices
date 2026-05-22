import assert from "node:assert/strict";
import test from "node:test";
import { classifyDeviceFormFactor } from "../src/deviceFormFactor.ts";

test("classifies compact phone displays", () => {
  assert.equal(classifyDeviceFormFactor("1080x2400", "440 dpi"), "phone");
});

test("classifies tablet-sized displays", () => {
  assert.equal(classifyDeviceFormFactor("1600x2560", "320 dpi"), "tablet");
});

test("classifies 15.6 inch and larger displays as large screens", () => {
  assert.equal(classifyDeviceFormFactor("1920x1080", "120 dpi"), "largeScreen");
});

test("prefers physical millimeter size when Android density is logical", () => {
  assert.equal(classifyDeviceFormFactor("1920x1080", "240 dpi", "531x299 mm"), "largeScreen");
});

test("keeps displays below 15.6 inches out of large screen", () => {
  assert.equal(classifyDeviceFormFactor("1920x1080", "120 dpi", "344x194 mm"), "tablet");
});

test("defaults to phone when display metrics are missing", () => {
  assert.equal(classifyDeviceFormFactor("", ""), "phone");
});
