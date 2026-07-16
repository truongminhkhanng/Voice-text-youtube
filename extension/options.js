/* global YtTtsShared */
(function initialiseOptions() {
  "use strict";

  const { DEFAULT_SETTINGS, MESSAGE } = YtTtsShared;
  const ids = [
    "settingsForm",
    "voiceSelect",
    "voiceWarning",
    "rate",
    "rateValue",
    "volume",
    "volumeValue",
    "enabled",
    "autoPlay",
    "preferVietnamese",
    "translateToVietnamese",
    "translationApiKey",
    "showKeyButton",
    "testTranslationButton",
    "translationFeedback",
    "resetButton",
    "saveFeedback"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let settings = { ...DEFAULT_SETTINGS };

  function isVietnameseVoice(voice) {
    return String(voice?.lang || "").toLowerCase().split("-")[0] === "vi";
  }

  function populateVoices() {
    const selected = elements.voiceSelect.value || settings.voiceURI;
    const voices = speechSynthesis.getVoices().slice().sort((left, right) => {
      const viFirst = Number(isVietnameseVoice(right)) - Number(isVietnameseVoice(left));
      return viFirst || left.name.localeCompare(right.name, "vi");
    });
    const groups = [
      ["Tiếng Việt", voices.filter(isVietnameseVoice)],
      ["Ngôn ngữ khác — chỉ dùng khi tự chọn", voices.filter((voice) => !isVietnameseVoice(voice))]
    ];

    elements.voiceSelect.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "Tự động — ưu tiên tiếng Việt";
    elements.voiceSelect.append(automatic);
    for (const [label, groupVoices] of groups) {
      if (!groupVoices.length) continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const voice of groupVoices) {
        const option = document.createElement("option");
        option.value = voice.voiceURI;
        option.textContent = `${voice.name} (${voice.lang})${voice.localService ? " · máy" : ""}`;
        group.append(option);
      }
      elements.voiceSelect.append(group);
    }
    elements.voiceSelect.value = voices.some((voice) => voice.voiceURI === selected) ? selected : "";
    elements.voiceWarning.hidden = voices.some(isVietnameseVoice);
  }

  function updateRangeLabels() {
    elements.rateValue.value = `${Number(elements.rate.value).toFixed(1)}×`;
    elements.volumeValue.value = `${Math.round(Number(elements.volume.value) * 100)}%`;
  }

  function applySettings(value) {
    settings = YtTtsShared.sanitiseSettings(value);
    for (const key of ["enabled", "autoPlay", "preferVietnamese", "translateToVietnamese"]) {
      elements[key].checked = settings[key];
    }
    elements.rate.value = settings.rate;
    elements.volume.value = settings.volume;
    elements.voiceSelect.value = settings.voiceURI;
    updateRangeLabels();
  }

  function readForm() {
    return YtTtsShared.sanitiseSettings({
      enabled: elements.enabled.checked,
      autoPlay: elements.autoPlay.checked,
      preferVietnamese: elements.preferVietnamese.checked,
      translateToVietnamese: elements.translateToVietnamese.checked,
      rate: elements.rate.value,
      volume: elements.volume.value,
      voiceURI: elements.voiceSelect.value
    });
  }

  async function saveAll() {
    settings = await YtTtsShared.saveSettings(readForm());
    await chrome.storage.local.set({
      translationApiKey: elements.translationApiKey.value.trim().slice(0, 500)
    });
  }

  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveAll();
      elements.saveFeedback.textContent = "Đã lưu cài đặt";
      setTimeout(() => (elements.saveFeedback.textContent = ""), 2200);
    } catch (error) {
      elements.saveFeedback.textContent = "Không thể lưu cài đặt";
    }
  });

  elements.resetButton.addEventListener("click", async () => {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    await chrome.storage.local.remove("translationApiKey");
    elements.translationApiKey.value = "";
    applySettings(DEFAULT_SETTINGS);
    populateVoices();
    elements.saveFeedback.textContent = "Đã khôi phục mặc định";
  });

  elements.showKeyButton.addEventListener("click", () => {
    const show = elements.translationApiKey.type === "password";
    elements.translationApiKey.type = show ? "text" : "password";
    elements.showKeyButton.textContent = show ? "Ẩn" : "Hiện";
  });

  elements.testTranslationButton.addEventListener("click", async () => {
    elements.testTranslationButton.disabled = true;
    elements.translationFeedback.textContent = "Đang thử…";
    try {
      await saveAll();
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.TRANSLATE,
        texts: ["Hello"],
        sourceLanguage: "en"
      });
      if (!response?.ok) throw new Error(response?.error || "API không phản hồi.");
      elements.translationFeedback.textContent = `Thành công: ${response.data.texts[0]}`;
    } catch (error) {
      elements.translationFeedback.textContent = error?.message || "Thử dịch thất bại.";
    } finally {
      elements.testTranslationButton.disabled = false;
    }
  });

  elements.rate.addEventListener("input", updateRangeLabels);
  elements.volume.addEventListener("input", updateRangeLabels);
  speechSynthesis.addEventListener("voiceschanged", populateVoices);

  Promise.all([
    YtTtsShared.loadSettings(),
    chrome.storage.local.get({ translationApiKey: "" })
  ]).then(([loadedSettings, local]) => {
    applySettings(loadedSettings);
    elements.translationApiKey.value = local.translationApiKey || "";
    populateVoices();
  });
})();
