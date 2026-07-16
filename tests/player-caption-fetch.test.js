"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMainWorldFunction(name, nextName, context) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "extension", "background.js"),
    "utf8"
  );
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
}

test("player caption fetch rebuilds the source JSON3 URL with the observed PO token", async () => {
  const fetchedUrls = [];
  const baseUrl = "https://www.youtube.com/api/timedtext?v=video123&lang=en";
  const player = {
    getPlayerResponse: () => ({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl,
            languageCode: "en",
            kind: "asr",
            vssId: "a.en"
          }]
        }
      }
    }),
    getOption: () => ({ languageCode: "en", vssId: "a.en" }),
    getAudioTrack: () => ({
      captionTracks: [{
        url: `${baseUrl}&pot=po-token&potc=1`,
        languageCode: "en",
        vssId: "a.en"
      }]
    }),
    getWebPlayerContextConfig: () => ({ innertubeContextClientVersion: "1.20260716" })
  };
  const context = {
    URL,
    URLSearchParams,
    location: { origin: "https://www.youtube.com" },
    document: {
      getElementById: () => player,
      querySelector: () => null
    },
    performance: { getEntriesByType: () => [] },
    fetch: async (url) => {
      fetchedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => '{"events":[]}'
      };
    },
    setTimeout,
    ytcfg: { get: () => "cbr=Chrome&cbrver=140&cos=Windows&cplatform=DESKTOP" }
  };
  context.globalThis = context;
  const fetchCaptionThroughPlayer = loadMainWorldFunction(
    "fetchCaptionThroughPlayer",
    "extractTranscriptPanelCues",
    context
  );

  const result = await fetchCaptionThroughPlayer("video123", "en", baseUrl);
  const requested = new URL(fetchedUrls[0]);

  assert.equal(result.ok, true);
  assert.equal(result.languageCode, "en");
  assert.equal(requested.searchParams.get("fmt"), "json3");
  assert.equal(requested.searchParams.has("tlang"), false);
  assert.equal(requested.searchParams.get("pot"), "po-token");
  assert.equal(requested.searchParams.get("potc"), "1");
  assert.equal(requested.searchParams.get("c"), "WEB");
  assert.equal(requested.searchParams.get("cplayer"), "UNIPLAYER");
  assert.equal(requested.searchParams.get("cbr"), "Chrome");
  assert.equal(requested.searchParams.get("cver"), "1.20260716");
});
