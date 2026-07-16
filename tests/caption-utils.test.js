"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../extension/lib/caption-utils.js");

test("parseJson3 joins segments and skips non-caption events", () => {
  const cues = utils.parseJson3({
    events: [
      { tStartMs: 100, dDurationMs: 900, segs: [{ utf8: "Xin " }, { utf8: "chào\n" }] },
      { tStartMs: 500, dDurationMs: 100 },
      { dDurationMs: 100, segs: [{ utf8: "missing start" }] }
    ]
  });

  assert.deepEqual(cues, [{ startMs: 100, durationMs: 900, text: "Xin chào" }]);
});

test("parseXml supports legacy text and srv3 p elements", () => {
  const legacy = utils.parseTranscriptPayload(
    '<transcript><text start="1.5" dur="2">Tom &amp; Jerry</text></transcript>'
  );
  const srv3 = utils.parseTranscriptPayload(
    '<timedtext><body><p t="2500" d="800"><s>Xin</s><s> chào</s></p></body></timedtext>'
  );

  assert.deepEqual(legacy, [{ startMs: 1500, durationMs: 2000, text: "Tom & Jerry" }]);
  assert.deepEqual(srv3, [{ startMs: 2500, durationMs: 800, text: "Xin chào" }]);
});

test("selectCaptionTrack prioritises a manual Vietnamese track", () => {
  const selected = utils.selectCaptionTrack([
    { baseUrl: "https://www.youtube.com/api/timedtext?a=1", languageCode: "en", name: { simpleText: "English" } },
    { baseUrl: "https://www.youtube.com/api/timedtext?a=2", languageCode: "vi", kind: "asr", name: { simpleText: "Vi auto" } },
    { baseUrl: "https://www.youtube.com/api/timedtext?a=3", languageCode: "vi-VN", name: { simpleText: "Tiếng Việt" } }
  ]);

  assert.equal(selected.name, "Tiếng Việt");
  assert.equal(selected.languageCode, "vi-VN");
});

test("extractBalancedJson ignores braces inside strings", () => {
  const source = 'ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc","title":"a } brace"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[]}}};';
  const parsed = utils.parsePlayerResponseScripts([source], "abc");

  assert.equal(parsed.videoDetails.title, "a } brace");
});

test("makeTimedTextUrl requests json3 while preserving the signed query", () => {
  const url = new URL(
    utils.makeTimedTextUrl("https://www.youtube.com/api/timedtext?v=abc&sig=secret&fmt=srv3")
  );

  assert.equal(url.searchParams.get("fmt"), "json3");
  assert.equal(url.searchParams.get("sig"), "secret");
});
