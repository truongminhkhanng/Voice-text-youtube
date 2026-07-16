(function initialiseTtsEngine(root, factory) {
  "use strict";

  const api = factory();
  root.YtTtsEngine = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(globalThis, function createTtsEngineApi() {
  "use strict";

  function isVietnameseVoice(voice) {
    return String(voice?.lang || "").toLowerCase().split("-")[0] === "vi";
  }

  function selectVoice(voices, voiceURI = "") {
    const available = Array.from(voices || []);
    if (voiceURI) {
      return available.find((voice) => voice.voiceURI === voiceURI) || null;
    }
    return available.find(isVietnameseVoice) || null;
  }

  class TtsEngine {
    constructor({ speechSynthesis, Utterance, onState = () => {}, onCue = () => {} }) {
      this.speechSynthesis = speechSynthesis;
      this.Utterance = Utterance;
      this.onState = onState;
      this.onCue = onCue;
      this.queue = [];
      this.index = 0;
      this.status = "stopped";
      this.runId = 0;
      this.settings = { rate: 1, volume: 0.8 };
      this.voice = null;
    }

    configure(settings) {
      this.settings = {
        rate: Number(settings?.rate) || 1,
        volume: Number.isFinite(Number(settings?.volume)) ? Number(settings.volume) : 0.8
      };
    }

    setQueue(cues) {
      this.stop();
      this.queue = Array.from(cues || []);
    }

    play(voice) {
      if (!this.queue.length) {
        throw new Error("Chưa có phụ đề để đọc.");
      }

      if (this.status === "paused") {
        this.speechSynthesis.resume();
        this.status = "speaking";
        this.emitState();
        return;
      }

      if (this.status === "speaking") {
        return;
      }

      this.voice = voice;
      const runId = ++this.runId;
      this.status = "speaking";
      this.emitState();
      this.speakNext(runId);
    }

    pause() {
      if (this.status !== "speaking") {
        return;
      }
      this.speechSynthesis.pause();
      this.status = "paused";
      this.emitState();
    }

    stop() {
      this.runId += 1;
      this.speechSynthesis.cancel();
      this.index = 0;
      this.status = "stopped";
      this.emitState();
    }

    emitState(extra = {}) {
      this.onState({
        playback: this.status,
        currentIndex: this.index,
        totalCues: this.queue.length,
        ...extra
      });
    }

    speakNext(runId) {
      if (runId !== this.runId) {
        return;
      }

      if (this.index >= this.queue.length) {
        this.index = 0;
        this.status = "stopped";
        this.emitState({ completed: true });
        return;
      }

      const cue = this.queue[this.index];
      const utterance = new this.Utterance(cue.text);
      utterance.rate = this.settings.rate;
      utterance.volume = this.settings.volume;
      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      } else {
        utterance.lang = "vi-VN";
      }

      utterance.onstart = () => {
        if (runId !== this.runId) {
          return;
        }
        this.onCue({ cue, index: this.index });
        this.emitState();
      };
      utterance.onend = () => {
        if (runId !== this.runId) {
          return;
        }
        this.index += 1;
        this.speakNext(runId);
      };
      utterance.onerror = (event) => {
        if (runId !== this.runId) {
          return;
        }
        this.status = "stopped";
        this.emitState({ error: event?.error || "speech-error" });
      };

      this.speechSynthesis.speak(utterance);
    }
  }

  return { TtsEngine, isVietnameseVoice, selectVoice };
});
