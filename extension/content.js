/* global SpeechSynthesisUtterance, YtTtsCaptionUtils, YtTtsEngine, YtTtsShared */
(function initialiseContentScript() {
  "use strict";

  if (globalThis.__YT_TTS_CONTENT_LOADED__) {
    return;
  }
  globalThis.__YT_TTS_CONTENT_LOADED__ = true;

  const { MESSAGE } = YtTtsShared;
  const captions = YtTtsCaptionUtils;
  const tts = YtTtsEngine;
  let settings = { ...YtTtsShared.DEFAULT_SETTINGS };
  let navigationToken = 0;
  let currentUrl = location.href;
  let availableVoices = [];
  let state = {
    phase: "idle",
    message: "Mở một video YouTube để bắt đầu.",
    videoId: "",
    videoTitle: "",
    cueCount: 0,
    languageCode: "",
    trackName: "",
    errorCode: "",
    playback: "stopped",
    currentIndex: 0,
    totalCues: 0,
    currentCue: "",
    vietnameseVoiceCount: 0,
    voiceCount: 0
  };
  let transcript = [];
  const ttsEngine = new tts.TtsEngine({
    speechSynthesis: globalThis.speechSynthesis,
    Utterance: SpeechSynthesisUtterance,
    onState(playbackState) {
      const patch = { ...playbackState };
      if (patch.error) {
        patch.phase = "ready";
        patch.errorCode = "TTS_FAILED";
        patch.message = `Giọng đọc gặp lỗi: ${patch.error}.`;
      } else if (patch.completed) {
        patch.phase = "ready";
        patch.message = "Đã đọc hết phụ đề.";
        patch.currentCue = "";
      }
      delete patch.error;
      delete patch.completed;
      setState(patch);
    },
    onCue({ cue, index }) {
      setState({ currentCue: cue.text, currentIndex: index });
    }
  });

  function currentVideoId() {
    return new URL(location.href).searchParams.get("v") || "";
  }

  function publicState() {
    return { ...state, settings, url: location.href };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    chrome.runtime
      .sendMessage({ type: MESSAGE.STATE_CHANGED, state: publicState() })
      .catch(() => {});
  }

  function makeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function updateVoices() {
    availableVoices = globalThis.speechSynthesis.getVoices();
    setState({
      voiceCount: availableVoices.length,
      vietnameseVoiceCount: availableVoices.filter(tts.isVietnameseVoice).length
    });
    return availableVoices;
  }

  async function ensureVoices() {
    if (updateVoices().length) {
      return availableVoices;
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        globalThis.speechSynthesis.removeEventListener("voiceschanged", finish);
        resolve();
      };
      globalThis.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
      setTimeout(finish, 1500);
    });
    return updateVoices();
  }

  async function controlPlayback(action) {
    if (action === "pause") {
      ttsEngine.pause();
      setState({ message: "Đã tạm dừng giọng đọc." });
      return publicState();
    }

    if (action === "stop") {
      ttsEngine.stop();
      setState({ currentCue: "", message: "Đã dừng. Sẵn sàng đọc lại từ đầu.", errorCode: "" });
      return publicState();
    }

    if (action !== "play") {
      throw makeError("UNKNOWN_COMMAND", "Lệnh điều khiển không hợp lệ.");
    }

    if (!transcript.length) {
      throw makeError("NO_CAPTIONS", state.message || "Chưa có phụ đề để đọc.");
    }

    const voices = await ensureVoices();
    const voice = tts.selectVoice(voices, settings.voiceURI);
    if (!voice) {
      if (settings.voiceURI) {
        throw makeError(
          "VOICE_NOT_FOUND",
          "Giọng đã chọn không còn khả dụng. Hãy chọn lại giọng đọc trong popup."
        );
      }
      throw makeError(
        "NO_VI_VOICE",
        "Máy của bạn chưa có giọng đọc tiếng Việt. Hãy cài gói giọng vi-VN hoặc tự chọn một giọng khác."
      );
    }

    ttsEngine.configure(settings);
    setState({ message: "Đang đọc phụ đề…", errorCode: "" });
    ttsEngine.play(voice);
    return publicState();
  }

  function parsePlayerDataFromDom(videoId) {
    const scriptTexts = Array.from(document.scripts)
      .filter((script) => script.textContent?.includes("captionTracks"))
      .map((script) => script.textContent);
    const response = captions.parsePlayerResponseScripts(scriptTexts, videoId);
    const renderer = captions.getRenderer(response);

    return {
      videoId: response?.videoDetails?.videoId || videoId,
      title: response?.videoDetails?.title || document.title.replace(/\s+-\s+YouTube$/, ""),
      tracks: renderer?.captionTracks || []
    };
  }

  async function requestPlayerData(videoId) {
    let mainWorldData = null;
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_PLAYER_DATA });
      if (response?.ok && response.data?.videoId === videoId) {
        mainWorldData = response.data;
        if (mainWorldData.tracks?.length) {
          return mainWorldData;
        }
      }
    } catch (error) {
      console.warn("[YT TTS] Không đọc được player data từ MAIN world:", error);
    }

    const domData = parsePlayerDataFromDom(videoId);
    return domData.tracks?.length ? domData : mainWorldData || domData;
  }

  async function waitForPlayerData(videoId, token) {
    let playerData = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      playerData = await requestPlayerData(videoId);
      if (playerData?.tracks?.length || token !== navigationToken) {
        return playerData;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return playerData;
  }

  async function requestTranscript(track) {
    const url = captions.makeTimedTextUrl(track.baseUrl);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE.FETCH_CAPTIONS,
      url,
      videoId: currentVideoId(),
      languageCode: track.languageCode
    });
    if (!response?.ok) {
      throw makeError(
        "CAPTION_FETCH_FAILED",
        response?.error || "Không thể tải nội dung phụ đề từ YouTube."
      );
    }

    const cues = Array.isArray(response.data.cues)
      ? response.data.cues
      : captions.parseTranscriptPayload(response.data.text);
    if (!cues.length) {
      throw makeError(
        "CAPTION_EMPTY",
        "YouTube đang yêu cầu PO Token cho phụ đề. Hãy bật nút CC hoặc mở “Hiện bản chép lời” một lần, rồi bấm Thử lại."
      );
    }

    return { cues, source: response.data.source || "unknown" };
  }

  async function translateTranscript(cues, sourceLanguage, token) {
    setState({
      phase: "loading",
      message: `Đang dịch ${cues.length} câu sang tiếng Việt qua Google Cloud…`,
      errorCode: ""
    });
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE.TRANSLATE,
      texts: cues.map((cue) => cue.text),
      sourceLanguage
    });
    if (token !== navigationToken) {
      return [];
    }
    if (!response?.ok) {
      throw makeError(
        response?.code || "TRANSLATION_FAILED",
        response?.error || "Không thể dịch phụ đề sang tiếng Việt."
      );
    }
    if (!Array.isArray(response.data?.texts) || response.data.texts.length !== cues.length) {
      throw makeError("TRANSLATION_INVALID_RESPONSE", "Kết quả dịch không khớp với phụ đề gốc.");
    }

    return cues.map((cue, index) => ({ ...cue, text: response.data.texts[index] }));
  }

  async function loadCaptions(reason = "navigation") {
    const token = ++navigationToken;
    const videoId = currentVideoId();
    transcript = [];
    ttsEngine.setQueue([]);

    if (!videoId) {
      setState({
        phase: "idle",
        message: "Mở một video YouTube để bắt đầu.",
        videoId: "",
        videoTitle: "",
        cueCount: 0,
        languageCode: "",
        trackName: "",
        errorCode: ""
      });
      return;
    }

    if (!settings.enabled) {
      setState({
        phase: "disabled",
        message: "Extension đang tắt.",
        videoId,
        cueCount: 0,
        errorCode: ""
      });
      return;
    }

    setState({
      phase: "loading",
      message: "Đang tìm phụ đề…",
      videoId,
      cueCount: 0,
      languageCode: "",
      sourceLanguageCode: "",
      translated: false,
      trackName: "",
      currentCue: "",
      errorCode: ""
    });

    try {
      const playerData = await waitForPlayerData(videoId, token);
      if (token !== navigationToken || videoId !== currentVideoId()) {
        return;
      }

      const track = captions.selectCaptionTrack(playerData.tracks, settings.preferVietnamese);
      if (!track) {
        throw makeError(
          "NO_CAPTIONS",
          playerData.playabilityReason
            ? `Không có phụ đề: ${playerData.playabilityReason}`
            : "Video này không cung cấp phụ đề khả dụng."
        );
      }

      const transcriptResult = await requestTranscript(track);
      let cues = transcriptResult.cues;
      if (token !== navigationToken || videoId !== currentVideoId()) {
        return;
      }

      const sourceLanguageCode = track.languageCode;
      const shouldTranslate =
        settings.translateToVietnamese && !captions.isVietnamese(sourceLanguageCode);
      if (shouldTranslate) {
        cues = await translateTranscript(cues, sourceLanguageCode, token);
      }
      if (token !== navigationToken || videoId !== currentVideoId()) {
        return;
      }

      transcript = cues;
      ttsEngine.configure(settings);
      ttsEngine.setQueue(cues);
      const needsTranslation = !captions.isVietnamese(track.languageCode) && !shouldTranslate;
      setState({
        phase: "ready",
        message: needsTranslation
          ? `Đã tải ${cues.length} câu (${track.languageCode}). Bật dịch sang tiếng Việt trước khi đọc.`
          : `Đã tải ${cues.length} câu phụ đề tiếng Việt.`,
        videoId,
        videoTitle: playerData.title || "",
        cueCount: cues.length,
        languageCode: shouldTranslate ? "vi" : track.languageCode,
        sourceLanguageCode,
        captionSource: transcriptResult.source,
        translated: shouldTranslate,
        trackName: shouldTranslate ? `Bản dịch từ ${track.name}` : track.name,
        errorCode: "",
        playback: "stopped",
        currentIndex: 0,
        totalCues: cues.length,
        currentCue: ""
      });
      console.info(`[YT TTS] Caption sẵn sàng (${reason}):`, {
        videoId,
        track,
        cueCount: cues.length,
        firstCue: cues[0],
        translated: shouldTranslate,
        captionSource: transcriptResult.source
      });
      if (settings.autoPlay) {
        controlPlayback("play").catch((error) => {
          setState({
            message: error?.message || "Chrome chưa cho phép tự động phát giọng đọc.",
            errorCode: error?.code || "AUTOPLAY_FAILED"
          });
        });
      }
    } catch (error) {
      if (token !== navigationToken) {
        return;
      }
      transcript = [];
      setState({
        phase: "error",
        message: error?.message || "Không thể lấy phụ đề.",
        cueCount: 0,
        errorCode: error?.code || "CAPTION_UNKNOWN"
      });
      console.error("[YT TTS] Lỗi caption:", error);
    }
  }

  function checkNavigation() {
    if (location.href === currentUrl) {
      return;
    }
    currentUrl = location.href;
    loadCaptions("spa-navigation");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MESSAGE.GET_STATUS) {
      sendResponse({ ok: true, data: publicState() });
      return false;
    }

    if (message?.type === MESSAGE.RELOAD_CAPTIONS) {
      loadCaptions("manual").then(() => sendResponse({ ok: true, data: publicState() }));
      return true;
    }

    if (message?.type === MESSAGE.CONTROL) {
      controlPlayback(message.action)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => {
          setState({
            phase: state.phase === "ready" ? "ready" : state.phase,
            message: error?.message || "Không thể điều khiển giọng đọc.",
            errorCode: error?.code || "TTS_UNKNOWN"
          });
          sendResponse({
            ok: false,
            error: error?.message || "Không thể điều khiển giọng đọc.",
            code: error?.code || "TTS_UNKNOWN"
          });
        });
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    settings = YtTtsShared.sanitiseSettings({ ...settings, ...Object.fromEntries(
      Object.entries(changes).map(([key, change]) => [key, change.newValue])
    ) });
    ttsEngine.configure(settings);
    const requiresReload = ["enabled", "preferVietnamese", "translateToVietnamese"].some(
      (key) => key in changes
    );
    if (requiresReload) {
      loadCaptions("settings-change");
    }
  });

  addEventListener("yt-navigate-finish", checkNavigation, true);
  addEventListener("popstate", checkNavigation, true);
  setInterval(checkNavigation, 1000);
  globalThis.speechSynthesis.addEventListener("voiceschanged", updateVoices);
  updateVoices();

  YtTtsShared.loadSettings().then((loaded) => {
    settings = loaded;
    loadCaptions("initial-load");
  });
})();
