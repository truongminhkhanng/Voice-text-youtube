/* global YtTtsShared */
(function initialisePopup() {
  "use strict";

  const { DEFAULT_SETTINGS, MESSAGE } = YtTtsShared;
  const elements = Object.fromEntries(
    [
      "enabled",
      "statusCard",
      "statusLabel",
      "statusMessage",
      "cueProgress",
      "retryButton",
      "trackMeta",
      "playButton",
      "pauseButton",
      "stopButton",
      "currentCue",
      "currentCueText",
      "voiceSelect",
      "voiceWarning",
      "rate",
      "rateValue",
      "volume",
      "volumeValue",
      "autoPlay",
      "translateToVietnamese",
      "optionsButton",
      "saveButton",
      "saveFeedback"
    ].map((id) => [id, document.getElementById(id)])
  );
  let settings = { ...DEFAULT_SETTINGS };
  let activeTabId = null;
  let statusPoll;

  function isVietnameseVoice(voice) {
    return String(voice?.lang || "").toLowerCase().split("-")[0] === "vi";
  }

  function updateRangeLabels() {
    elements.rateValue.value = `${Number(elements.rate.value).toFixed(1)}×`;
    elements.volumeValue.value = `${Math.round(Number(elements.volume.value) * 100)}%`;
  }

  function applySettings(value) {
    settings = YtTtsShared.sanitiseSettings(value);
    elements.enabled.checked = settings.enabled;
    elements.voiceSelect.value = settings.voiceURI;
    elements.rate.value = settings.rate;
    elements.volume.value = settings.volume;
    elements.autoPlay.checked = settings.autoPlay;
    elements.translateToVietnamese.checked = settings.translateToVietnamese;
    updateRangeLabels();
  }

  function readSettingsForm() {
    return YtTtsShared.sanitiseSettings({
      ...settings,
      enabled: elements.enabled.checked,
      voiceURI: elements.voiceSelect.value,
      rate: elements.rate.value,
      volume: elements.volume.value,
      autoPlay: elements.autoPlay.checked,
      translateToVietnamese: elements.translateToVietnamese.checked
    });
  }

  function populateVoices() {
    const currentValue = elements.voiceSelect.value || settings.voiceURI;
    const voices = speechSynthesis.getVoices().slice().sort((left, right) => {
      const languageScore = Number(isVietnameseVoice(right)) - Number(isVietnameseVoice(left));
      return languageScore || left.name.localeCompare(right.name, "vi");
    });
    const vietnamese = voices.filter(isVietnameseVoice);
    const other = voices.filter((voice) => !isVietnameseVoice(voice));

    elements.voiceSelect.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "Tự động — ưu tiên tiếng Việt";
    elements.voiceSelect.append(automatic);

    function appendGroup(label, groupVoices) {
      if (!groupVoices.length) return;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const voice of groupVoices) {
        const option = document.createElement("option");
        option.value = voice.voiceURI;
        option.textContent = `${voice.name} (${voice.lang})`;
        group.append(option);
      }
      elements.voiceSelect.append(group);
    }

    appendGroup("Tiếng Việt", vietnamese);
    appendGroup("Ngôn ngữ khác — chọn thủ công", other);
    elements.voiceSelect.value = voices.some((voice) => voice.voiceURI === currentValue)
      ? currentValue
      : "";
    elements.voiceWarning.hidden = vietnamese.length > 0;
  }

  function renderStatus(state) {
    if (!state) return;
    const phaseLabels = {
      disabled: "Đã tắt",
      error: "Cần xử lý",
      idle: "Chờ video",
      loading: "Đang tải",
      ready: state.playback === "speaking" ? "Đang đọc" : state.playback === "paused" ? "Đã tạm dừng" : "Sẵn sàng"
    };
    const hasActionableError = Boolean(state.errorCode);
    const tone = hasActionableError || state.phase === "error"
      ? "error"
      : state.phase === "ready"
        ? "success"
        : state.phase === "loading"
          ? "loading"
          : "neutral";
    elements.statusCard.dataset.tone = tone;
    elements.statusLabel.textContent = hasActionableError
      ? "Cần xử lý"
      : phaseLabels[state.phase] || "Trạng thái";
    elements.statusMessage.textContent = state.message || "Không có thông tin trạng thái.";
    elements.cueProgress.textContent = state.totalCues
      ? `${Math.min(state.currentIndex + (state.playback === "speaking" ? 1 : 0), state.totalCues)}/${state.totalCues}`
      : "";
    elements.trackMeta.hidden = !state.trackName && !state.displayedCaptionMode;
    elements.trackMeta.textContent = state.displayedCaptionMode
      ? "Nguồn đọc: phụ đề đang hiển thị trên YouTube"
      : state.trackName
        ? `Track: ${state.trackName} · ${state.languageCode || "không rõ ngôn ngữ"}`
      : "";
    elements.currentCue.hidden = !state.currentCue;
    elements.currentCueText.textContent = state.currentCue || "";
    elements.retryButton.hidden = !hasActionableError && state.phase !== "error";

    const ready = state.phase === "ready" && state.totalCues > 0;
    elements.playButton.disabled = !ready || state.playback === "speaking";
    elements.pauseButton.disabled = state.playback !== "speaking";
    elements.stopButton.disabled = !["speaking", "paused"].includes(state.playback);
    elements.playButton.querySelector("span:last-child").textContent =
      state.playback === "paused" ? "Tiếp tục" : "Phát";
  }

  function renderConnectionError(message) {
    renderStatus({
      phase: "error",
      message,
      playback: "stopped",
      totalCues: 0,
      currentIndex: 0
    });
  }

  async function refreshStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_ACTIVE_STATUS });
      if (!response?.ok) {
        throw new Error(response?.error || "Không đọc được trạng thái tab.");
      }
      activeTabId = response.data?.tabId || response.tabId || activeTabId;
      const state = response.data?.data || response.data;
      renderStatus(state);
    } catch (error) {
      renderConnectionError(error?.message || "Không kết nối được với tab YouTube.");
    }
  }

  async function sendControl(action) {
    for (const button of [elements.playButton, elements.pauseButton, elements.stopButton]) {
      button.disabled = true;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.COMMAND_ACTIVE_TAB,
        action
      });
      if (!response?.ok || response.data?.ok === false) {
        throw new Error(response?.data?.error || response?.error || "Không thực hiện được lệnh.");
      }
      renderStatus(response.data?.data || response.data);
    } catch (error) {
      renderConnectionError(error?.message || "Không điều khiển được giọng đọc.");
    }
    await refreshStatus();
  }

  async function save() {
    elements.saveButton.disabled = true;
    try {
      settings = await YtTtsShared.saveSettings(readSettingsForm());
      elements.saveFeedback.textContent = "Đã lưu";
      setTimeout(() => {
        elements.saveFeedback.textContent = "";
      }, 1800);
    } catch (error) {
      elements.saveFeedback.textContent = "Lưu thất bại";
    } finally {
      elements.saveButton.disabled = false;
    }
  }

  elements.rate.addEventListener("input", updateRangeLabels);
  elements.volume.addEventListener("input", updateRangeLabels);
  elements.playButton.addEventListener("click", () => sendControl("play"));
  elements.pauseButton.addEventListener("click", () => sendControl("pause"));
  elements.stopButton.addEventListener("click", () => sendControl("stop"));
  elements.retryButton.addEventListener("click", () => sendControl("reload"));
  elements.saveButton.addEventListener("click", save);
  elements.optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  speechSynthesis.addEventListener("voiceschanged", populateVoices);

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === MESSAGE.STATE_CHANGED && (!activeTabId || sender.tab?.id === activeTabId)) {
      renderStatus(message.state);
    }
  });

  Promise.all([YtTtsShared.loadSettings(), refreshStatus()]).then(([loaded]) => {
    applySettings(loaded);
    populateVoices();
    statusPoll = setInterval(refreshStatus, 1500);
  });

  addEventListener("unload", () => clearInterval(statusPoll), { once: true });
})();
