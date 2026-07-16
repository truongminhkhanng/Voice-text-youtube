"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBatches, validateTexts } = require("../extension/lib/translation-utils.js");

test("createBatches respects item and character limits without changing order", () => {
  const batches = createBatches(["1234", "56", "789", "0"], 2, 6);
  assert.deepEqual(batches, [["1234", "56"], ["789", "0"]]);
  assert.deepEqual(batches.flat(), ["1234", "56", "789", "0"]);
});

test("validateTexts rejects unexpectedly expensive translation payloads", () => {
  assert.deepEqual(validateTexts(["Hello", "World"]), ["Hello", "World"]);
  assert.throws(() => validateTexts([]), /Không có nội dung/);
  assert.throws(() => validateTexts(["x".repeat(5001)]), /quá dài/);
});
