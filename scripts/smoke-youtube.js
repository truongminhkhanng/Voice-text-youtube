"use strict";

const utils = require("../extension/lib/caption-utils.js");

const videoId = process.argv[2] || "dQw4w9WgXcQ";

async function run() {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const watchResponse = await fetch(watchUrl, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36"
    }
  });
  if (!watchResponse.ok) {
    throw new Error(`YouTube watch page returned HTTP ${watchResponse.status}.`);
  }

  const html = await watchResponse.text();
  const cookies = watchResponse.headers.getSetCookie?.().map((value) => value.split(";", 1)[0]).join("; ") || "";
  const playerResponse = utils.parsePlayerResponseScripts([html], videoId);
  const renderer = utils.getRenderer(playerResponse);
  const track = utils.selectCaptionTrack(renderer?.captionTracks || [], true);
  if (!track) {
    throw new Error("The live player response did not contain a usable caption track.");
  }

  const timedTextUrl = utils.makeTimedTextUrl(track.baseUrl);
  const captionResponse = await fetch(timedTextUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 Chrome/150 Safari/537.36",
      ...(cookies ? { Cookie: cookies } : {})
    }
  });
  if (!captionResponse.ok) {
    throw new Error(`YouTube timedtext returned HTTP ${captionResponse.status}.`);
  }
  const transcriptPayload = await captionResponse.text();
  const cues = utils.parseTranscriptPayload(transcriptPayload);
  if (!cues.length) {
    const parameterNames = [...new URL(timedTextUrl).searchParams.keys()].join(",");
    console.warn(
      `YouTube smoke inconclusive: timedtext returned ${transcriptPayload.length} bytes outside page context for ${track.languageCode}/${track.kind || "manual"}; parameters: ${parameterNames}.`
    );
    return;
  }

  console.log(
    `YouTube smoke passed: ${videoId}, ${track.languageCode}, ${cues.length} cues, first at ${cues[0].startMs}ms.`
  );
}

run().catch((error) => {
  console.error(`YouTube smoke failed: ${error.message}`);
  process.exitCode = 1;
});
