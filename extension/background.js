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
        return pageResult;
      }
    } catch (error) {
      // Fall back to the service worker request below if page-context fetch is unavailable.
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
    text: await response.text()
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
