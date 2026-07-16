"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageRuntimeSource = ["background.js", "content.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"))
  .join("\n");

test("extension never changes YouTube caption or player state", () => {
  assert.doesNotMatch(pageRuntimeSource, /\bsetOption\s*\(/, "must not replace the active caption track");
  assert.doesNotMatch(pageRuntimeSource, /\bloadModule\s*\(/, "must not load or toggle caption modules");
  assert.doesNotMatch(pageRuntimeSource, /\.click\s*\(/, "must not click YouTube controls or panels");
  assert.doesNotMatch(pageRuntimeSource, /video\.(?:muted|volume)\s*=/, "must not alter YouTube audio");
});
