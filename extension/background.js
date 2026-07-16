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
  let activeCaptionTrack = {};
  let activeTranslationLanguage = {};
  try {
    activeCaptionTrack = player?.getOption?.("captions", "track") || {};
  } catch (error) {
    activeCaptionTrack = {};
  }
  try {
    activeTranslationLanguage =
      player?.getOption?.("captions", "translationLanguage") ||
      player?.getOption?.("captions", "translation_language") ||
      {};
  } catch (error) {
    activeTranslationLanguage = {};
  }
  const activeCaptionLanguageCode = String(
    activeCaptionTrack?.languageCode ||
      activeCaptionTrack?.language_code ||
      activeCaptionTrack?.lang ||
      ""
  );
  const activeCaptionVssId = String(
    activeCaptionTrack?.vssId || activeCaptionTrack?.vss_id || ""
  );
  let audioCaptionTracks = [];
  try {
    audioCaptionTracks = (player?.getAudioTrack?.()?.captionTracks || []).flatMap((track) => {
      try {
        const url = new URL(String(track?.url || ""), location.origin).toString();
        return [{
          url,
          vssId: String(track?.vssId || track?.vss_id || ""),
          kind: String(track?.kind || ""),
          languageCode: new URL(url).searchParams.get("lang") || ""
        }];
      } catch (error) {
        return [];
      }
    });
  } catch (error) {
    audioCaptionTracks = [];
  }
  let capturedTimedTextUrls = [];
  try {
    capturedTimedTextUrls = globalThis.__YT_TTS_TIMEDTEXT_CAPTURE__?.list(currentVideoId) || [];
  } catch (error) {
    capturedTimedTextUrls = [];
  }
  const activeCaptionTranslationLanguageCode = String(
    activeCaptionTrack?.translationLanguage?.languageCode ||
      activeCaptionTrack?.translationLanguage?.language_code ||
      activeCaptionTrack?.translationLanguageCode ||
      activeCaptionTrack?.tlang ||
      activeTranslationLanguage?.languageCode ||
      activeTranslationLanguage?.language_code ||
      (typeof activeTranslationLanguage === "string" ? activeTranslationLanguage : "") ||
      ""
  );
  let activeResourceLanguageCode = "";
  try {
    const timedTextUrls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/api/timedtext"))
      .reverse()
      .filter((name) => {
        const url = new URL(name);
        return !url.searchParams.get("v") || url.searchParams.get("v") === currentVideoId;
      });
    const recentTimedTextUrl =
      timedTextUrls.find((name) => new URL(name).searchParams.has("tlang")) || timedTextUrls[0];
    if (recentTimedTextUrl) {
      const url = new URL(recentTimedTextUrl);
      activeResourceLanguageCode =
        url.searchParams.get("tlang") || url.searchParams.get("lang") || "";
    }
  } catch (error) {
    activeResourceLanguageCode = "";
  }
  const tracks = (renderer?.captionTracks || []).flatMap((track) => {
    try {
      return [{
        baseUrl: track?.baseUrl
          ? String(new URL(String(track.baseUrl), location.origin))
          : "",
        languageCode: String(track?.languageCode || ""),
        kind: String(track?.kind || ""),
        vssId: String(track?.vssId || track?.vss_id || ""),
        name:
          track?.name?.simpleText ||
          track?.name?.runs?.map((run) => run?.text || "").join("") ||
          track?.languageCode ||
          "Unknown",
        isTranslatable: Boolean(track?.isTranslatable),
        isDefault: Boolean(track?.isDefault)
      }];
    } catch (error) {
      return [];
    }
  });
  let device = "";
  let cver = "";
  let playerState = -1;
  try {
    device = globalThis.ytcfg?.get?.("DEVICE") || "";
    cver = player?.getWebPlayerContextConfig?.()?.innertubeContextClientVersion || "";
    playerState = player?.getPlayerState?.() ?? -1;
  } catch (error) {
    device = "";
    cver = "";
    playerState = -1;
  }

  return {
    videoId: chosen?.videoDetails?.videoId || currentVideoId,
    title: chosen?.videoDetails?.title || document.title.replace(/\s+-\s+YouTube$/, ""),
    playabilityReason: chosen?.playabilityStatus?.reason || "",
    captionIsActive: Boolean(
      activeCaptionLanguageCode ||
        document.querySelector(".ytp-caption-window-container .ytp-caption-segment")
    ),
    activeCaptionLanguageCode,
    activeCaptionTranslationLanguageCode,
    activeCaptionVssId,
    activeResourceLanguageCode,
    audioCaptionTracks,
    capturedTimedTextUrls,
    device,
    cver,
    playerState,
    tracks
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
    text: await response.text(),
    languageCode: new URL(url).searchParams.get("tlang") || new URL(url).searchParams.get("lang") || ""
  };
}

async function fetchCaptionThroughPlayer(
  videoId,
  preferredLanguageCode,
  targetLanguageCode,
  requestedTrackUrl
) {
  const player = document.getElementById("movie_player");
  if (!player) {
    return { ok: false, text: "", source: "player", reason: "PLAYER_NOT_FOUND" };
  }

  const normaliseLanguage = (value) => String(value || "").toLowerCase().split("-")[0];
  const preferredLanguage = normaliseLanguage(preferredLanguageCode);
  const targetLanguage = normaliseLanguage(targetLanguageCode);
  const desiredLanguage = targetLanguage || preferredLanguage;
  const response = player.getPlayerResponse?.();
  const rawTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const tracks = rawTracks.flatMap((track) => {
    try {
      if (!track?.baseUrl) return [];
      return [{
        baseUrl: new URL(String(track.baseUrl), location.origin).toString(),
        languageCode: String(track.languageCode || ""),
        kind: String(track.kind || ""),
        vssId: String(track.vssId || track.vss_id || "")
      }];
    } catch (error) {
      return [];
    }
  });
  let activeTrack = {};
  try {
    activeTrack = player.getOption?.("captions", "track") || {};
  } catch (error) {
    activeTrack = {};
  }
  const activeVssId = String(activeTrack?.vssId || activeTrack?.vss_id || "");
  const selectedTrack =
    tracks.find((track) => activeVssId && track.vssId === activeVssId) ||
    tracks.find((track) => normaliseLanguage(track.languageCode) === preferredLanguage) ||
    tracks[0] ||
    null;

  function readObservedUrls() {
    let capturedUrls = [];
    let audioTrackUrls = [];
    try {
      capturedUrls = (globalThis.__YT_TTS_TIMEDTEXT_CAPTURE__?.list(videoId) || [])
        .map((item) => item.url)
        .filter(Boolean);
    } catch (error) {
      capturedUrls = [];
    }
    try {
      audioTrackUrls = (player.getAudioTrack?.()?.captionTracks || [])
        .map((track) => String(track?.url || ""))
        .filter(Boolean);
    } catch (error) {
      audioTrackUrls = [];
    }
    const performanceUrls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/api/timedtext"))
      .reverse();
    return [...capturedUrls, ...performanceUrls, ...audioTrackUrls].filter((rawUrl) => {
      try {
        const candidateVideoId = new URL(rawUrl, location.origin).searchParams.get("v");
        return !candidateVideoId || candidateVideoId === videoId;
      } catch (error) {
        return false;
      }
    });
  }

  let allObservedUrls = readObservedUrls();
  const captionsEnabled =
    Boolean(activeTrack?.languageCode || activeTrack?.language_code) ||
    document.querySelector(".ytp-subtitles-button")?.getAttribute("aria-pressed") === "true" ||
    Boolean(document.querySelector(".ytp-caption-window-container .ytp-caption-segment"));
  for (let attempt = 0; attempt < 10 && captionsEnabled; attempt += 1) {
    const hasPoToken = allObservedUrls.some((rawUrl) => {
      try {
        return new URL(rawUrl, location.origin).searchParams.has("pot");
      } catch (error) {
        return false;
      }
    });
    if (hasPoToken) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
    allObservedUrls = readObservedUrls();
  }
  const scoreUrl = (rawUrl) => {
    try {
      const url = new URL(rawUrl, location.origin);
      let score = 0;
      const effectiveLanguage = normaliseLanguage(
        url.searchParams.get("tlang") || url.searchParams.get("lang")
      );
      if (url.searchParams.get("v") === videoId) score += 16;
      if (effectiveLanguage === desiredLanguage) score += 12;
      if (normaliseLanguage(url.searchParams.get("lang")) === preferredLanguage) score += 4;
      if (url.searchParams.has("pot")) score += 8;
      if (url.searchParams.has("potc")) score += 2;
      return score;
    } catch (error) {
      return -1;
    }
  };
  allObservedUrls.sort((left, right) => scoreUrl(right) - scoreUrl(left));
  const poTokenUrl = allObservedUrls.find((rawUrl) => {
    try {
      return new URL(rawUrl, location.origin).searchParams.has("pot");
    } catch (error) {
      return false;
    }
  });

  const device = new URLSearchParams(String(globalThis.ytcfg?.get?.("DEVICE") || ""));
  const clientVersion = String(
    player.getWebPlayerContextConfig?.()?.innertubeContextClientVersion || ""
  );
  const clientParameters = {
    fmt: "json3",
    xorb: "2",
    xobt: "3",
    xovt: "3",
    c: "WEB",
    cplayer: "UNIPLAYER"
  };
  const deviceKeys = ["cbrand", "cbr", "cbrver", "cos", "cosver", "cplatform"];

  function buildCandidate(rawUrl) {
    const url = new URL(rawUrl, location.origin);
    if (url.pathname !== "/api/timedtext") return null;
    if (url.searchParams.get("v") && url.searchParams.get("v") !== videoId) return null;
    for (const [key, value] of Object.entries(clientParameters)) {
      url.searchParams.set(key, value);
    }
    for (const key of deviceKeys) {
      const value = device.get(key);
      if (value) url.searchParams.set(key, value);
    }
    if (clientVersion) url.searchParams.set("cver", clientVersion);
    if (targetLanguage) {
      url.searchParams.set("tlang", targetLanguageCode);
    }
    if (poTokenUrl) {
      const tokenSource = new URL(poTokenUrl, location.origin);
      const poToken = tokenSource.searchParams.get("pot");
      const poTokenContext = tokenSource.searchParams.get("potc");
      if (poToken && !url.searchParams.has("pot")) url.searchParams.set("pot", poToken);
      if (poTokenContext && !url.searchParams.has("potc")) {
        url.searchParams.set("potc", poTokenContext);
      }
    }
    return url.toString();
  }

  const baseCandidates = [
    ...allObservedUrls,
    requestedTrackUrl,
    selectedTrack?.baseUrl
  ].filter(Boolean);
  const candidates = [...new Set(baseCandidates.flatMap((rawUrl) => {
    try {
      const candidate = buildCandidate(rawUrl);
      return candidate ? [candidate] : [];
    } catch (error) {
      return [];
    }
  }))];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const effectiveLanguage = normaliseLanguage(
        url.searchParams.get("tlang") || url.searchParams.get("lang")
      );
      if (desiredLanguage && effectiveLanguage !== desiredLanguage) continue;
      const captionResponse = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json, text/xml;q=0.9, */*;q=0.8" }
      });
      const text = await captionResponse.text();
      if (captionResponse.ok && text) {
        return {
          ok: true,
          status: captionResponse.status,
          contentType: captionResponse.headers.get("content-type") || "",
          text,
          source: url.searchParams.has("pot") ? "captured-po-token" : "player-resource",
          languageCode: effectiveLanguage
        };
      }
    } catch (error) {
      // Try the next captured or reconstructed URL without changing YouTube player state.
    }
  }

  return {
    ok: false,
    text: "",
    source: "captured-resource-readonly",
    reason: candidates.length ? "CAPTION_RESPONSES_EMPTY" : "NO_CAPTURED_RESOURCE"
  };
}

async function extractTranscriptPanelCues() {
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

  return {
    ok: false,
    cues: [],
    source: "transcript-panel-readonly",
    reason: "PANEL_NOT_AVAILABLE"
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
    let playerAttempted = false;
    const requestFromPlayer = async () => {
      playerAttempted = true;
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
        world: "MAIN",
        func: fetchCaptionThroughPlayer,
        args: [
          message.videoId || "",
          message.languageCode || "",
          message.targetLanguageCode || "",
          message.url || ""
        ]
      });
      return results[0]?.result;
    };

    if (message.targetLanguageCode) {
      try {
        const playerResult = await requestFromPlayer();
        if (playerResult?.ok && playerResult.text) {
          return playerResult;
        }
      } catch (error) {
        // Try the original track URL next.
      }
    }

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
      const playerResult = playerAttempted ? null : await requestFromPlayer();
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
        return {
          ...transcriptResult,
          languageCode: message.targetLanguageCode || message.languageCode || ""
        };
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
    source: "service-worker",
    languageCode:
      new URL(message.url).searchParams.get("tlang") ||
      new URL(message.url).searchParams.get("lang") ||
      ""
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
