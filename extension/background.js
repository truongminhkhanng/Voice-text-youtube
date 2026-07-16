/* global YtTtsCaptionUtils, YtTtsShared, YtTtsTranslationUtils */
"use strict";

importScripts("shared.js", "lib/caption-utils.js", "lib/translation-utils.js");

const { DEFAULT_SETTINGS, MESSAGE } = YtTtsShared;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set(YtTtsShared.sanitiseSettings(existing));
});

function extractMainWorldPlayerData() {
  const currentVideoId = new URL(location.href).searchParams.get("v") || "";
  const player = document.getElementById("movie_player");
  const watch = document.querySelector("ytd-watch-flexy");
  const candidates = [
    window.ytInitialPlayerResponse,
    typeof player?.getPlayerResponse === "function" ? player.getPlayerResponse() : null,
    watch?.playerData,
    watch?.data?.playerResponse,
    watch?.data?.playerData
  ].filter(Boolean);

  const chosen =
    candidates.find((candidate) => candidate?.videoDetails?.videoId === currentVideoId) ||
    candidates.find((candidate) => candidate?.captions?.playerCaptionsTracklistRenderer) ||
    null;
  const renderer = chosen?.captions?.playerCaptionsTracklistRenderer;

  return {
    videoId: chosen?.videoDetails?.videoId || currentVideoId,
    title: chosen?.videoDetails?.title || document.title.replace(/\s+-\s+YouTube$/, ""),
    playabilityReason: chosen?.playabilityStatus?.reason || "",
    tracks: (renderer?.captionTracks || []).map((track) => ({
      baseUrl: String(track?.baseUrl || ""),
      languageCode: String(track?.languageCode || ""),
      kind: String(track?.kind || ""),
      name:
        track?.name?.simpleText ||
        track?.name?.runs?.map((run) => run?.text || "").join("") ||
        track?.languageCode ||
        "Unknown",
      isTranslatable: Boolean(track?.isTranslatable),
      isDefault: Boolean(track?.isDefault)
    }))
  };
}

function isAllowedYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) &&
      url.pathname === "/api/timedtext"
    );
  } catch (error) {
    return false;
  }
}

async function fetchCaptionInPage(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json, text/xml;q=0.9, */*;q=0.8" }
  });
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    text: await response.text()
  };
}

async function fetchCaptionThroughPlayer(videoId, preferredLanguageCode) {
  const player = document.getElementById("movie_player");
  if (!player) {
    return { ok: false, text: "", source: "player", reason: "PLAYER_NOT_FOUND" };
  }

  performance.setResourceTimingBufferSize?.(5000);
  const normaliseLanguage = (value) => String(value || "").toLowerCase().split("-")[0];
  const preferredLanguage = normaliseLanguage(preferredLanguageCode);

  async function tryTimedTextEntries() {
    const entries = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/api/timedtext"))
      .reverse();

    const ranked = entries.sort((left, right) => {
      const score = (rawUrl) => {
        try {
          const url = new URL(rawUrl);
          let value = 0;
          if (url.searchParams.get("v") === videoId) value += 8;
          if (normaliseLanguage(url.searchParams.get("lang")) === preferredLanguage) value += 4;
          if (url.searchParams.has("pot")) value += 2;
          return value;
        } catch (error) {
          return 0;
        }
      };
      return score(right) - score(left);
    });

    for (const rawUrl of ranked) {
      try {
        const url = new URL(rawUrl);
        if (url.searchParams.get("v") && url.searchParams.get("v") !== videoId) continue;
        url.searchParams.set("fmt", "json3");
        const response = await fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json, text/xml;q=0.9, */*;q=0.8" }
        });
        const text = await response.text();
        if (response.ok && text) {
          return {
            ok: true,
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            text,
            source: "player-po-token"
          };
        }
      } catch (error) {
        // Try another resource entry.
      }
    }
    return null;
  }

  const existing = await tryTimedTextEntries();
  if (existing) return existing;

  let previousTrack = null;
  let changedTrack = false;
  try {
    player.loadModule?.("captions");
    await new Promise((resolve) => setTimeout(resolve, 200));
    previousTrack = player.getOption?.("captions", "track") || {};
    const rawTrackList = player.getOption?.("captions", "tracklist") || [];
    const trackList = Array.isArray(rawTrackList)
      ? rawTrackList
      : rawTrackList.captionTracks || rawTrackList.tracks || [];
    const trackLanguage = (track) =>
      normaliseLanguage(track?.languageCode || track?.language_code || track?.lang);
    const selectedTrack =
      trackList.find((track) => trackLanguage(track) === preferredLanguage) ||
      trackList[0] ||
      { languageCode: preferredLanguageCode };

    if (trackLanguage(previousTrack) === preferredLanguage) {
      player.setOption?.("captions", "track", {});
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    player.setOption?.("captions", "track", selectedTrack);
    changedTrack = true;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = await tryTimedTextEntries();
      if (result) return result;
    }
  } catch (error) {
    return { ok: false, text: "", source: "player", reason: error?.message || "PLAYER_ERROR" };
  } finally {
    if (changedTrack) {
      try {
        player.setOption?.("captions", "track", previousTrack || {});
      } catch (error) {
        // Restoring the user's caption choice is best-effort only.
      }
    }
  }

  return { ok: false, text: "", source: "player", reason: "NO_TOKENISED_RESOURCE" };
}

async function extractTranscriptPanelCues() {
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function timestampToMs(value) {
    const parts = String(value || "")
      .trim()
      .split(":")
      .map(Number);
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return Number.NaN;
    return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
  }

  function finalise(cues) {
    const unique = new Map();
    for (const cue of cues) {
      if (!cue.text || !Number.isFinite(cue.startMs)) continue;
      unique.set(`${cue.startMs}:${cue.text}`, cue);
    }
    const sorted = [...unique.values()].sort((left, right) => left.startMs - right.startMs);
    return sorted.map((cue, index) => ({
      startMs: cue.startMs,
      durationMs:
        Number.isFinite(cue.durationMs) && cue.durationMs > 0
          ? cue.durationMs
          : Math.max(0, (sorted[index + 1]?.startMs || cue.startMs + 2500) - cue.startMs),
      text: cue.text
    }));
  }

  function readDom() {
    return finalise(
      Array.from(document.querySelectorAll("ytd-transcript-segment-renderer")).map((node) => ({
        startMs: timestampToMs(
          node.querySelector(".segment-timestamp, [class*='segment-timestamp']")?.textContent
        ),
        durationMs: 0,
        text: cleanText(node.querySelector(".segment-text, [class*='segment-text']")?.textContent)
      }))
    );
  }

  function readAttachedData() {
    const roots = [
      document.querySelector("ytd-transcript-segment-list-renderer")?.data,
      document.querySelector("ytd-transcript-segment-list-renderer")?.__data,
      document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
      )?.data
    ].filter(Boolean);
    const cues = [];
    const seen = new Set();
    let visited = 0;

    function visit(value, depth = 0) {
      if (!value || typeof value !== "object" || seen.has(value) || depth > 16 || visited > 50000) {
        return;
      }
      seen.add(value);
      visited += 1;
      const segment = value.transcriptSegmentRenderer;
      if (segment) {
        const startMs = Number(segment.startMs);
        const endMs = Number(segment.endMs);
        const text = cleanText(
          segment.snippet?.simpleText ||
            segment.snippet?.runs?.map((run) => run?.text || "").join("")
        );
        cues.push({
          startMs,
          durationMs: Number.isFinite(endMs) ? endMs - startMs : 0,
          text
        });
      }
      for (const child of Object.values(value)) visit(child, depth + 1);
    }

    for (const root of roots) visit(root);
    return finalise(cues);
  }

  let cues = readAttachedData();
  if (cues.length) return { ok: true, cues, source: "transcript-panel-data" };
  cues = readDom();
  if (cues.length) return { ok: true, cues, source: "transcript-panel-dom" };

  const expandButton = document.querySelector(
    "ytd-text-inline-expander #expand, #description-inline-expander #expand, tp-yt-paper-button#expand"
  );
  expandButton?.click();
  if (expandButton) await wait(250);

  const transcriptButton = document.querySelector(
    "ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer tp-yt-paper-button"
  );
  transcriptButton?.click();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(250);
    cues = readAttachedData();
    if (cues.length) return { ok: true, cues, source: "transcript-panel-data" };
    cues = readDom();
    if (cues.length) return { ok: true, cues, source: "transcript-panel-dom" };
  }

  return {
    ok: false,
    cues: [],
    source: "transcript-panel",
    reason: transcriptButton ? "PANEL_EMPTY" : "BUTTON_NOT_FOUND"
  };
}

async function getPlayerData(sender) {
  if (!sender.tab?.id) {
    throw new Error("Không xác định được tab YouTube.");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
    world: "MAIN",
    func: extractMainWorldPlayerData
  });

  return results[0]?.result || { tracks: [] };
}

async function fetchCaptions(message, sender) {
  if (!isAllowedYouTubeUrl(message.url)) {
    throw new Error("URL phụ đề không hợp lệ.");
  }

  if (sender.tab?.id) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
        world: "MAIN",
        func: fetchCaptionInPage,
        args: [message.url]
      });
      const pageResult = results[0]?.result;
      if (pageResult?.ok && pageResult.text) {
        return { ...pageResult, source: "track-url" };
      }
    } catch (error) {
      // Fall back to the service worker request below if page-context fetch is unavailable.
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
        world: "MAIN",
        func: fetchCaptionThroughPlayer,
        args: [message.videoId || "", message.languageCode || ""]
      });
      const playerResult = results[0]?.result;
      if (playerResult?.ok && playerResult.text) {
        return playerResult;
      }
    } catch (error) {
      // Try the transcript UI fallback below.
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
        world: "MAIN",
        func: extractTranscriptPanelCues
      });
      const transcriptResult = results[0]?.result;
      if (transcriptResult?.ok && transcriptResult.cues?.length) {
        return transcriptResult;
      }
    } catch (error) {
      // The final service-worker request preserves the old fallback and diagnostics.
    }
  }

  const response = await fetch(message.url, {
    credentials: "include",
    headers: { Accept: "application/json, text/xml;q=0.9, */*;q=0.8" }
  });

  if (!response.ok) {
    throw new Error(`YouTube trả về HTTP ${response.status} khi tải phụ đề.`);
  }

  return {
    ok: true,
    contentType: response.headers.get("content-type") || "",
    text: await response.text(),
    source: "service-worker"
  };
}

function isYouTubePage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"))
    );
  } catch (error) {
    return false;
  }
}

async function getActiveYouTubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isYouTubePage(tab.url)) {
    throw new Error("Tab hiện tại không phải YouTube. Hãy mở một video rồi thử lại.");
  }
  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveYouTubeTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return { ...response, tabId: tab.id };
  } catch (error) {
    throw new Error(
      "Chưa kết nối được với trang YouTube. Hãy tải lại tab sau khi cài hoặc cập nhật extension."
    );
  }
}

async function commandActiveTab(message) {
  const allowedActions = new Set(["play", "pause", "stop", "reload"]);
  if (!allowedActions.has(message.action)) {
    throw new Error("Lệnh điều khiển không hợp lệ.");
  }
  if (message.action === "reload") {
    return sendToActiveTab({ type: MESSAGE.RELOAD_CAPTIONS });
  }
  return sendToActiveTab({ type: MESSAGE.CONTROL, action: message.action });
}

async function getActiveStatus() {
  return sendToActiveTab({ type: MESSAGE.GET_STATUS });
}

function makeBackgroundError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function translateTexts(message) {
  const texts = YtTtsTranslationUtils.validateTexts(message.texts);
  const { translationApiKey = "" } = await chrome.storage.local.get("translationApiKey");
  const apiKey = typeof translationApiKey === "string" ? translationApiKey.trim() : "";
  if (!apiKey) {
    throw makeBackgroundError(
      "TRANSLATION_API_KEY_MISSING",
      "Chưa có Google Cloud Translation API key. Hãy nhập khóa trong Cài đặt nâng cao."
    );
  }

  const source = String(message.sourceLanguage || "").toLowerCase().split("-")[0];
  const batches = YtTtsTranslationUtils.createBatches(texts);
  const translated = [];

  for (const batch of batches) {
    const url = new URL("https://translation.googleapis.com/language/translate/v2");
    url.searchParams.set("key", apiKey);
    const body = { q: batch, target: "vi", format: "text" };
    if (source && source !== "und") {
      body.source = source;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw makeBackgroundError(
        "TRANSLATION_FAILED",
        payload?.error?.message || `Google Cloud Translation trả về HTTP ${response.status}.`
      );
    }

    const results = payload?.data?.translations;
    if (!Array.isArray(results) || results.length !== batch.length) {
      throw makeBackgroundError(
        "TRANSLATION_INVALID_RESPONSE",
        "Dịch vụ dịch trả về dữ liệu không đầy đủ."
      );
    }
    translated.push(
      ...results.map((item) => YtTtsCaptionUtils.decodeEntities(item?.translatedText || ""))
    );
  }

  return { texts: translated, targetLanguage: "vi", sourceLanguage: source || "auto" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  let operation;
  if (message.type === MESSAGE.GET_PLAYER_DATA) {
    operation = getPlayerData(sender);
  } else if (message.type === MESSAGE.FETCH_CAPTIONS) {
    operation = fetchCaptions(message, sender);
  } else if (message.type === MESSAGE.COMMAND_ACTIVE_TAB) {
    operation = commandActiveTab(message);
  } else if (message.type === MESSAGE.GET_ACTIVE_STATUS) {
    operation = getActiveStatus();
  } else if (message.type === MESSAGE.TRANSLATE) {
    operation = translateTexts(message);
  } else {
    return false;
  }

  operation
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error?.message || "Lỗi không xác định.",
        code: error?.code || "BACKGROUND_ERROR"
      })
    );
  return true;
});
