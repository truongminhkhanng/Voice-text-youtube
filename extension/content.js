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
    displayedCaptionMode: false,
    displayedCaptionSource: "",
    liveCaptionMode: false,
    vietnameseVoiceCount: 0,
    voiceCount: 0
  };
  let transcript = [];
  let currentCaptionTrack = null;
  let nativeLanguageMonitorTimer = null;
  let nativeLanguageMonitorGeneration = 0;
  const ttsEngine = new tts.TtsEngine({
    speechSynthesis: globalThis.speechSynthesis,
    Utterance: SpeechSynthesisUtterance,
    onState(playbackState) {
      const patch = { ...playbackState };
      if (patch.error) {
        stopNativeLanguageMonitor();
        patch.phase = "ready";
        patch.errorCode = "TTS_FAILED";
        patch.message = `Giọng đọc gặp lỗi: ${patch.error}.`;
      } else if (patch.completed) {
        stopNativeLanguageMonitor();
        patch.phase = "ready";
        patch.message = "Video đã kết thúc; giọng đọc đã dừng.";
        patch.currentCue = "";
      } else if (patch.videoPaused) {
        patch.message = "Video đang tạm dừng; giọng đọc đang chờ.";
      } else if (patch.playback === "speaking" && patch.waitingForCue) {
        if (state.displayedCaptionMode || state.liveCaptionMode) {
          patch.message = "Đang chờ dòng phụ đề tiếp theo trên YouTube…";
        } else {
          patch.message = "Đang chờ đúng mốc phụ đề tiếp theo…";
        }
      } else if (patch.playback === "speaking") {
        if (state.displayedCaptionMode || state.liveCaptionMode) {
          patch.message = "Đang đọc đúng dòng phụ đề hiện trên YouTube…";
        } else {
          patch.message = "Đang đọc đồng bộ theo video…";
        }
      }
      if (patch.clearCue) {
        patch.currentCue = "";
      }
      delete patch.error;
      delete patch.completed;
      delete patch.videoPaused;
      delete patch.waitingForCue;
      delete patch.clearCue;
      setState(patch);
    },
    onCue({ cue, index }) {
      setState({ currentCue: cue.text, currentIndex: index });
    }
  });

  function currentVideoId() {
    return new URL(location.href).searchParams.get("v") || "";
  }

  function requiresVietnameseOutput() {
    return settings.preferVietnamese || settings.translateToVietnamese;
  }

  function activeNativeLanguageCode(playerData) {
    return (
      playerData?.activeCaptionTranslationLanguageCode ||
      playerData?.activeCaptionLanguageCode ||
      ""
    );
  }

  function stopNativeLanguageMonitor() {
    nativeLanguageMonitorGeneration += 1;
    if (nativeLanguageMonitorTimer !== null) {
      clearTimeout(nativeLanguageMonitorTimer);
      nativeLanguageMonitorTimer = null;
    }
  }

  function startNativeLanguageMonitor(videoId) {
    stopNativeLanguageMonitor();
    if (!requiresVietnameseOutput()) return;

    const generation = nativeLanguageMonitorGeneration;
    const check = async () => {
      if (
        generation !== nativeLanguageMonitorGeneration ||
        currentVideoId() !== videoId ||
        !state.liveCaptionMode
      ) {
        return;
      }

      try {
        const playerData = await requestPlayerData(videoId);
        if (generation !== nativeLanguageMonitorGeneration) return;
        const activeLanguage = activeNativeLanguageCode(playerData);
        if (activeLanguage && !captions.isVietnamese(activeLanguage)) {
          stopNativeLanguageMonitor();
          ttsEngine.stop();
          setState({
            phase: "error",
            message: "YouTube không còn hiển thị phụ đề tiếng Việt nên giọng đọc đã dừng. Hãy chọn Phụ đề → Dịch tự động → Tiếng Việt, rồi bấm Thử lại.",
            errorCode: "YOUTUBE_VIETNAMESE_NOT_ACTIVE",
            liveCaptionMode: false,
            displayedCaptionMode: false,
            currentCue: ""
          });
          return;
        }
      } catch (error) {
        // A transient read failure must not interrupt speech or alter YouTube.
      }

      if (generation === nativeLanguageMonitorGeneration) {
        nativeLanguageMonitorTimer = setTimeout(check, 750);
      }
    };

    nativeLanguageMonitorTimer = setTimeout(check, 750);
  }

  function captionsAreDisplayed() {
    const captionsButton = document.querySelector(".ytp-subtitles-button");
    return (
      captionsButton?.getAttribute("aria-pressed") === "true" ||
      Boolean(document.querySelector(".ytp-caption-window-container .ytp-caption-segment"))
    );
  }

  function readDisplayedCaptionText() {
    const segments = Array.from(
      document.querySelectorAll(".ytp-caption-window-container .ytp-caption-segment")
    ).filter((segment) => segment.isConnected && segment.getClientRects().length > 0);
    return captions.cleanCaptionText(segments.map((segment) => segment.textContent || "").join(" "));
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
      stopNativeLanguageMonitor();
      ttsEngine.pause();
      setState({ message: "Đã tạm dừng giọng đọc." });
      return publicState();
    }

    if (action === "stop") {
      stopNativeLanguageMonitor();
      ttsEngine.stop();
      setState({ currentCue: "", message: "Đã dừng. Bấm Phát để đọc tại vị trí video hiện tại.", errorCode: "" });
      return publicState();
    }

    if (action !== "play") {
      throw makeError("UNKNOWN_COMMAND", "Lệnh điều khiển không hợp lệ.");
    }

    const useLiveCaptions = state.liveCaptionMode && !transcript.length;
    if (!transcript.length && !useLiveCaptions) {
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

    const video = document.querySelector("video.html5-main-video, video");
    if (!video) {
      throw makeError("VIDEO_NOT_FOUND", "Không tìm thấy trình phát video YouTube để đồng bộ giọng đọc.");
    }

    if (useLiveCaptions) {
      if (!captionsAreDisplayed()) {
        throw makeError(
          "CAPTIONS_NOT_VISIBLE",
          "Hãy tự bật nút CC của YouTube. Extension không tự click hoặc thay đổi phụ đề để tránh xung đột."
        );
      }
      if (requiresVietnameseOutput()) {
        const latestPlayerData = await requestPlayerData(currentVideoId());
        const activeNativeLanguage = activeNativeLanguageCode(latestPlayerData);
        if (!captions.isVietnamese(activeNativeLanguage)) {
          throw makeError(
            "YOUTUBE_VIETNAMESE_NOT_ACTIVE",
            "Hãy chọn Phụ đề → Dịch tự động → Tiếng Việt trên YouTube, rồi bấm Thử lại."
          );
        }
      }
      ttsEngine.configure(settings);
      setState({
        message: "Đang đọc đúng dòng phụ đề hiện trên YouTube…",
        displayedCaptionMode: true,
        displayedCaptionSource: "youtube",
        errorCode: ""
      });
      ttsEngine.playLiveCaptions(video, voice, readDisplayedCaptionText);
      startNativeLanguageMonitor(currentVideoId());
      return publicState();
    }

    ttsEngine.configure(settings);
    setState({
      message: "Đang đồng bộ giọng đọc theo phụ đề của video…",
      displayedCaptionMode: false,
      displayedCaptionSource: "",
      errorCode: ""
    });
    ttsEngine.playTimeline(video, voice);
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
        "YouTube không trả tệp phụ đề; extension sẽ chuyển sang đọc trực tiếp dòng CC đang chạy."
      );
    }

    return {
      cues,
      source: response.data.source || "unknown",
      languageCode: response.data.languageCode || track.languageCode
    };
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
    stopNativeLanguageMonitor();
    transcript = [];
    currentCaptionTrack = null;
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
        liveCaptionMode: false,
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
        liveCaptionMode: false,
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
      displayedCaptionMode: false,
      displayedCaptionSource: "",
      liveCaptionMode: false,
      trackName: "",
      currentCue: "",
      errorCode: ""
    });

    let playerData = null;
    try {
      playerData = await waitForPlayerData(videoId, token);
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
      currentCaptionTrack = track;

      if (requiresVietnameseOutput()) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const activeLanguage = activeNativeLanguageCode(playerData);
          if (captions.isVietnamese(activeLanguage)) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (token !== navigationToken || videoId !== currentVideoId()) return;
          const refreshedPlayerData = await requestPlayerData(videoId);
          if (refreshedPlayerData?.tracks?.length) playerData = refreshedPlayerData;
        }
      }

      const activeYouTubeLanguageCode = activeNativeLanguageCode(playerData);
      const useYouTubeVietnamese = captions.isVietnamese(activeYouTubeLanguageCode);
      if (useYouTubeVietnamese) {
        ttsEngine.setQueue([]);
        setState({
          phase: "ready",
          message: captionsAreDisplayed()
            ? "YouTube đang hiển thị bản dịch tiếng Việt; sẵn sàng đọc trực tiếp."
            : "YouTube đã chọn tiếng Việt. Hãy tự bật nút CC rồi bấm Phát.",
          videoId,
          videoTitle: playerData.title || "",
          cueCount: 0,
          languageCode: "vi",
          sourceLanguageCode: track.languageCode,
          captionSource: "youtube-native",
          youtubeTranslationActive: true,
          translated: true,
          trackName: `Bản dịch native YouTube từ ${track.name}`,
          displayedCaptionMode: true,
          displayedCaptionSource: "youtube",
          liveCaptionMode: true,
          errorCode: "",
          playback: "stopped",
          currentIndex: 0,
          totalCues: 0,
          currentCue: ""
        });
        if (settings.autoPlay && captionsAreDisplayed()) {
          controlPlayback("play").catch(() => {});
        }
        return;
      }
      if (settings.preferVietnamese && !settings.translateToVietnamese) {
        setState({
          phase: "error",
          message: "Extension không can thiệp YouTube. Hãy chọn Phụ đề → Dịch tự động → Tiếng Việt, bật CC, rồi bấm Thử lại.",
          videoId,
          videoTitle: playerData.title || "",
          cueCount: 0,
          languageCode: "",
          sourceLanguageCode: track.languageCode,
          trackName: track.name,
          displayedCaptionMode: false,
          displayedCaptionSource: "",
          liveCaptionMode: false,
          errorCode: "YOUTUBE_VIETNAMESE_NOT_ACTIVE",
          playback: "stopped",
          totalCues: 0,
          currentCue: ""
        });
        return;
      }
      const transcriptResult = await requestTranscript(track);
      let cues = transcriptResult.cues;
      if (token !== navigationToken || videoId !== currentVideoId()) {
        return;
      }

      const sourceLanguageCode = track.languageCode;
      const captionLanguageCode = transcriptResult.languageCode || sourceLanguageCode;
      const shouldTranslate =
        settings.translateToVietnamese && !captions.isVietnamese(captionLanguageCode);
      if (shouldTranslate) {
        cues = await translateTranscript(cues, sourceLanguageCode, token);
      }
      if (token !== navigationToken || videoId !== currentVideoId()) {
        return;
      }

      transcript = cues;
      ttsEngine.configure(settings);
      ttsEngine.setQueue(cues);
      const translatedByYouTube =
        captions.isVietnamese(captionLanguageCode) &&
        !captions.isVietnamese(sourceLanguageCode);
      const finalLanguageCode = shouldTranslate ? "vi" : captionLanguageCode;
      const needsTranslation = !captions.isVietnamese(finalLanguageCode);
      setState({
        phase: "ready",
        message: needsTranslation
          ? `Đã tải ${cues.length} câu (${track.languageCode}). Bật dịch sang tiếng Việt trước khi đọc.`
          : `Đã tải ${cues.length} câu phụ đề tiếng Việt.`,
        videoId,
        videoTitle: playerData.title || "",
        cueCount: cues.length,
        languageCode: finalLanguageCode,
        sourceLanguageCode,
        captionSource: transcriptResult.source,
        youtubeTranslationActive: translatedByYouTube,
        translated: shouldTranslate || translatedByYouTube,
        trackName: shouldTranslate
          ? `Bản dịch Google từ ${track.name}`
          : translatedByYouTube
            ? `Bản dịch YouTube từ ${track.name}`
            : track.name,
        displayedCaptionMode: false,
        displayedCaptionSource: "",
        liveCaptionMode: false,
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
        translated: shouldTranslate || translatedByYouTube,
        youtubeTranslationDetected: useYouTubeVietnamese,
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
      if (playerData?.tracks?.length && ["CAPTION_EMPTY", "CAPTION_FETCH_FAILED"].includes(error?.code)) {
        ttsEngine.setQueue([]);
        const nativeVietnamese = captions.isVietnamese(activeNativeLanguageCode(playerData));
        if (!nativeVietnamese && requiresVietnameseOutput()) {
          setState({
            phase: "error",
            message: "Extension không can thiệp YouTube. Hãy chọn Phụ đề → Dịch tự động → Tiếng Việt, bật CC, rồi bấm Thử lại.",
            cueCount: 0,
            languageCode: "",
            liveCaptionMode: false,
            displayedCaptionMode: false,
            errorCode: "YOUTUBE_VIETNAMESE_NOT_ACTIVE"
          });
          return;
        }
        setState({
          phase: "ready",
          message: captionsAreDisplayed()
            ? nativeVietnamese
              ? "Sẵn sàng đọc trực tiếp từng dòng phụ đề tiếng Việt của YouTube."
              : "Sẵn sàng đọc trực tiếp từng dòng phụ đề đang hiển thị trên YouTube."
            : "Hãy tự bật nút CC của YouTube rồi bấm Phát.",
          videoId,
          videoTitle: playerData.title || "",
          cueCount: 0,
          languageCode: nativeVietnamese ? "vi" : currentCaptionTrack?.languageCode || "",
          sourceLanguageCode: currentCaptionTrack?.languageCode || "",
          captionSource: "youtube-live",
          youtubeTranslationActive: Boolean(
            playerData.activeCaptionTranslationLanguageCode &&
              captions.isVietnamese(playerData.activeCaptionTranslationLanguageCode)
          ),
          translated: nativeVietnamese,
          trackName: nativeVietnamese
            ? "Phụ đề tiếng Việt native của YouTube"
            : "Phụ đề native của YouTube",
          displayedCaptionMode: true,
          displayedCaptionSource: "youtube",
          liveCaptionMode: true,
          errorCode: "",
          playback: "stopped",
          currentIndex: 0,
          totalCues: 0,
          currentCue: ""
        });
        if (settings.autoPlay) {
          controlPlayback("play").catch((playError) => {
            setState({
              message: playError?.message || "Chrome chưa cho phép tự động phát giọng đọc.",
              errorCode: playError?.code || "AUTOPLAY_FAILED"
            });
          });
        }
        return;
      }
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
