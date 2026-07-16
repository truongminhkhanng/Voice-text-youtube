"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadShared() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "extension", "shared.js"),
    "utf8"
  );
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.YtTtsShared;
}

test("speech rate settings support 0.5x through 4x", () => {
  const shared = loadShared();

  assert.equal(shared.sanitiseSettings({ rate: 3 }).rate, 3);
  assert.equal(shared.sanitiseSettings({ rate: 4 }).rate, 4);
  assert.equal(shared.sanitiseSettings({ rate: 9 }).rate, 4);
  assert.equal(shared.sanitiseSettings({ rate: 0.1 }).rate, 0.5);
});
