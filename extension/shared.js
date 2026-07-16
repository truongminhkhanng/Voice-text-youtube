(function initialiseShared(root) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    voiceURI: "",
    rate: 1,
    volume: 0.8,
    autoPlay: false,
    preferVietnamese: true,
    translateToVietnamese: false
  });

  const MESSAGE = Object.freeze({
    GET_PLAYER_DATA: "YT_TTS_GET_PLAYER_DATA",
    FETCH_CAPTIONS: "YT_TTS_FETCH_CAPTIONS",
    TRANSLATE: "YT_TTS_TRANSLATE",
    COMMAND_ACTIVE_TAB: "YT_TTS_COMMAND_ACTIVE_TAB",
    GET_ACTIVE_STATUS: "YT_TTS_GET_ACTIVE_STATUS",
    GET_STATUS: "YT_TTS_GET_STATUS",
    CONTROL: "YT_TTS_CONTROL",
    RELOAD_CAPTIONS: "YT_TTS_RELOAD_CAPTIONS",
    STATE_CHANGED: "YT_TTS_STATE_CHANGED"
  });

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : fallback;
  }

  function sanitiseSettings(value = {}) {
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
      voiceURI: typeof value.voiceURI === "string" ? value.voiceURI.slice(0, 500) : "",
      rate: clamp(value.rate, 0.5, 4, DEFAULT_SETTINGS.rate),
      volume: clamp(value.volume, 0, 1, DEFAULT_SETTINGS.volume),
      autoPlay: typeof value.autoPlay === "boolean" ? value.autoPlay : DEFAULT_SETTINGS.autoPlay,
      preferVietnamese:
        typeof value.preferVietnamese === "boolean"
          ? value.preferVietnamese
          : DEFAULT_SETTINGS.preferVietnamese,
      translateToVietnamese:
        typeof value.translateToVietnamese === "boolean"
          ? value.translateToVietnamese
          : DEFAULT_SETTINGS.translateToVietnamese
    };
  }

  async function loadSettings() {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return sanitiseSettings(stored);
  }

  async function saveSettings(settings) {
    const clean = sanitiseSettings(settings);
    await chrome.storage.sync.set(clean);
    return clean;
  }

  root.YtTtsShared = {
    DEFAULT_SETTINGS,
    MESSAGE,
    sanitiseSettings,
    loadSettings,
    saveSettings
  };
})(globalThis);
