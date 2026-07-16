"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageRuntimeSource = ["background.js", "content.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"))
  .join("\n");
const contentSource = fs.readFileSync(
  path.join(__dirname, "..", "extension", "content.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

test("extension leaves YouTube caption UI and network hooks untouched", () => {
  assert.doesNotMatch(pageRuntimeSource, /\bsetOption\s*\(/, "must not replace the active caption track");
  assert.doesNotMatch(pageRuntimeSource, /\bloadModule\s*\(/, "must not load or toggle caption modules");
  assert.doesNotMatch(pageRuntimeSource, /\.click\s*\(/, "must not click any YouTube control");
  assert.doesNotMatch(pageRuntimeSource, /\.dispatchEvent\s*\(/, "must not synthesize YouTube UI events");
  assert.doesNotMatch(pageRuntimeSource, /video\.(?:muted|volume)\s*=/, "must not alter YouTube audio");
  assert.doesNotMatch(pageRuntimeSource, /(?:window|rootWindow)\.fetch\s*=/, "must not wrap YouTube fetch");
  assert.doesNotMatch(
    pageRuntimeSource,
    /XMLHttpRequest\.prototype\.(?:open|send)\s*=/,
    "must not wrap YouTube XMLHttpRequest"
  );
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(
    manifest.content_scripts.flatMap((entry) => entry.js || []).some((file) => file.includes("interceptor")),
    false,
    "must not inject a network interceptor into the YouTube page"
  );
});

test("native Vietnamese mode returns before making any timedtext request", () => {
  const loadStart = contentSource.indexOf("async function loadCaptions");
  const loadEnd = contentSource.indexOf("function checkNavigation", loadStart);
  const loadSource = contentSource.slice(loadStart, loadEnd);
  const nativeReturnAt = loadSource.indexOf("if (useYouTubeVietnamese)");
  const requestTranslationAt = loadSource.indexOf("await requestTranscript(track)");

  assert.notEqual(nativeReturnAt, -1);
  assert.notEqual(requestTranslationAt, -1);
  assert.ok(nativeReturnAt < requestTranslationAt, "native VI must bypass extension caption requests");
  assert.match(
    contentSource,
    /YOUTUBE_VIETNAMESE_NOT_ACTIVE[\s\S]*Dịch tự động → Tiếng Việt/,
    "extension must instruct the user without changing YouTube settings"
  );
  assert.doesNotMatch(
    contentSource,
    /targetLanguageCode\s*:\s*["']vi["']/,
    "content script must not request a separate YouTube auto-translation"
  );
  assert.match(
    contentSource,
    /settings\.preferVietnamese\s*\|\|\s*settings\.translateToVietnamese/,
    "all modes requiring Vietnamese output must reject an English live fallback"
  );
  assert.doesNotMatch(
    contentSource,
    /captions\.isVietnamese\(currentCaptionTrack\?\.languageCode\)/,
    "a downloadable track must not be mistaken for the track displayed by YouTube"
  );
  assert.match(
    contentSource,
    /startNativeLanguageMonitor\(currentVideoId\(\)\)/,
    "live reading must stop if YouTube switches away from Vietnamese"
  );
});
