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

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  class TtsEngine {
    constructor({
      speechSynthesis,
      Utterance,
      onState = () => {},
      onCue = () => {},
      timelineIntervalMs = 100,
      liveCaptionStableMs = 120
    }) {
      this.speechSynthesis = speechSynthesis;
      this.Utterance = Utterance;
      this.onState = onState;
      this.onCue = onCue;
      this.timelineIntervalMs = timelineIntervalMs;
      this.liveCaptionStableMs = liveCaptionStableMs;
      this.queue = [];
      this.index = 0;
      this.status = "stopped";
      this.mode = "sequential";
      this.runId = 0;
      this.utteranceToken = 0;
      this.settings = { rate: 1, volume: 0.8 };
      this.voice = null;
      this.video = null;
      this.timelineTimer = null;
      this.timelineHandlers = null;
      this.timelineTextProvider = null;
      this.liveCaptionProvider = null;
      this.liveCaptionCandidate = "";
      this.liveCaptionCandidateSince = 0;
      this.liveLastSpokenText = "";
      this.liveBlankSince = 0;
      this.liveSequence = 0;
      this.activeCueIndex = -1;
      this.videoWasPaused = false;
    }

    configure(settings) {
      this.settings = {
        rate: clamp(Number(settings?.rate) || 1, 0.5, 4),
        volume: Number.isFinite(Number(settings?.volume))
          ? clamp(Number(settings.volume), 0, 1)
          : 0.8
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

      if (this.status === "paused" && this.mode === "sequential") {
        this.speechSynthesis.resume();
        this.status = "speaking";
        this.emitState();
        return;
      }

      if (this.status === "speaking") {
        return;
      }

      this.detachTimeline();
      this.mode = "sequential";
      this.voice = voice;
      const runId = ++this.runId;
      this.status = "speaking";
      this.emitState();
      this.speakNext(runId);
    }

    playTimeline(video, voice, textProvider = null) {
      if (!this.queue.length) {
        throw new Error("Chưa có phụ đề để đọc.");
      }
      if (!video || !Number.isFinite(Number(video.currentTime))) {
        throw new Error("Không tìm thấy video để đồng bộ giọng đọc.");
      }

      if (this.status === "speaking" && this.mode === "timeline" && this.video === video) {
        this.timelineTextProvider = typeof textProvider === "function" ? textProvider : null;
        this.syncToTimeline();
        return;
      }

      if (this.status === "paused" && this.mode === "timeline" && this.video === video) {
        this.voice = voice || this.voice;
        this.timelineTextProvider = typeof textProvider === "function" ? textProvider : null;
        this.cancelActiveCue();
        this.speechSynthesis.resume();
        this.videoWasPaused = false;
        this.status = "speaking";
        this.emitState();
        this.syncToTimeline();
        return;
      }

      this.stop();
      this.mode = "timeline";
      this.video = video;
      this.voice = voice;
      this.timelineTextProvider = typeof textProvider === "function" ? textProvider : null;
      this.status = "speaking";
      this.runId += 1;
      this.attachTimeline();
      this.emitState();
      this.syncToTimeline();
    }

    playLiveCaptions(video, voice, textProvider) {
      if (!video || !Number.isFinite(Number(video.currentTime))) {
        throw new Error("Không tìm thấy video để đồng bộ giọng đọc.");
      }
      if (typeof textProvider !== "function") {
        throw new Error("Không đọc được phụ đề đang hiển thị trên YouTube.");
      }

      if (this.status === "speaking" && this.mode === "live" && this.video === video) {
        this.liveCaptionProvider = textProvider;
        this.syncToTimeline();
        return;
      }

      if (this.status === "paused" && this.mode === "live" && this.video === video) {
        this.voice = voice || this.voice;
        this.liveCaptionProvider = textProvider;
        this.cancelActiveCue();
        this.speechSynthesis.resume();
        this.videoWasPaused = false;
        this.status = "speaking";
        this.emitState();
        this.syncToTimeline();
        return;
      }

      this.stop();
      this.mode = "live";
      this.video = video;
      this.voice = voice;
      this.liveCaptionProvider = textProvider;
      this.liveCaptionCandidate = "";
      this.liveCaptionCandidateSince = 0;
      this.liveLastSpokenText = "";
      this.liveBlankSince = 0;
      this.liveSequence = 0;
      this.status = "speaking";
      this.runId += 1;
      this.attachTimeline();
      this.emitState({ waitingForCue: true });
      this.syncToTimeline();
    }

    pause() {
      if (this.status !== "speaking") {
        return;
      }

      if (this.mode === "timeline" || this.mode === "live") {
        this.cancelActiveCue();
      } else {
        this.speechSynthesis.pause();
      }
      this.status = "paused";
      this.emitState({ waitingForCue: this.mode === "timeline" || this.mode === "live" });
    }

    stop() {
      this.runId += 1;
      this.utteranceToken += 1;
      this.detachTimeline();
      this.speechSynthesis.cancel();
      this.speechSynthesis.resume();
      this.index = 0;
      this.activeCueIndex = -1;
      this.videoWasPaused = false;
      this.status = "stopped";
      this.mode = "sequential";
      this.timelineTextProvider = null;
      this.liveCaptionProvider = null;
      this.liveCaptionCandidate = "";
      this.liveLastSpokenText = "";
      this.liveBlankSince = 0;
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

    attachTimeline() {
      const sync = () => this.syncToTimeline();
      const seeking = () => {
        if (!["timeline", "live"].includes(this.mode) || this.status !== "speaking") {
          return;
        }
        this.cancelActiveCue();
        this.emitState({ waitingForCue: true, clearCue: true });
      };
      this.timelineHandlers = { sync, seeking };

      if (typeof this.video?.addEventListener === "function") {
        this.video.addEventListener("play", sync);
        this.video.addEventListener("pause", sync);
        this.video.addEventListener("ended", sync);
        this.video.addEventListener("seeked", sync);
        this.video.addEventListener("ratechange", sync);
        this.video.addEventListener("seeking", seeking);
      }

      this.timelineTimer = setInterval(sync, this.timelineIntervalMs);
      this.timelineTimer?.unref?.();
    }

    detachTimeline() {
      if (this.timelineTimer !== null) {
        clearInterval(this.timelineTimer);
        this.timelineTimer = null;
      }
      if (this.timelineHandlers && typeof this.video?.removeEventListener === "function") {
        const { sync, seeking } = this.timelineHandlers;
        this.video.removeEventListener("play", sync);
        this.video.removeEventListener("pause", sync);
        this.video.removeEventListener("ended", sync);
        this.video.removeEventListener("seeked", sync);
        this.video.removeEventListener("ratechange", sync);
        this.video.removeEventListener("seeking", seeking);
      }
      this.timelineHandlers = null;
      this.video = null;
    }

    syncToTimeline() {
      if (!["timeline", "live"].includes(this.mode) || this.status !== "speaking" || !this.video) {
        return;
      }

      if (this.video.ended) {
        this.finishTimeline();
        return;
      }

      if (this.video.paused) {
        if (!this.videoWasPaused) {
          this.speechSynthesis.pause();
          this.videoWasPaused = true;
          this.emitState({ videoPaused: true, waitingForCue: true });
        }
        return;
      }

      if (this.videoWasPaused) {
        this.speechSynthesis.resume();
        this.videoWasPaused = false;
        this.emitState({ videoPaused: false });
      }

      if (this.mode === "live") {
        this.syncLiveCaptions();
        return;
      }

      const cueIndex = this.findCueIndexAt(Number(this.video.currentTime) * 1000);
      if (cueIndex < 0) {
        if (this.activeCueIndex >= 0) {
          this.cancelActiveCue();
          this.emitState({ waitingForCue: true, clearCue: true });
        }
        return;
      }

      if (cueIndex === this.activeCueIndex) {
        return;
      }

      this.cancelActiveCue();
      this.speakTimelineCue(cueIndex);
    }

    syncLiveCaptions() {
      let displayedText = "";
      try {
        displayedText = String(this.liveCaptionProvider?.() || "").replace(/\s+/g, " ").trim();
      } catch (error) {
        displayedText = "";
      }

      const now = Date.now();
      if (!displayedText) {
        if (!this.liveBlankSince) this.liveBlankSince = now;
        if (now - this.liveBlankSince >= 500) this.liveLastSpokenText = "";
        if (this.activeCueIndex >= 0) {
          this.cancelActiveCue();
          this.emitState({ waitingForCue: true, clearCue: true });
        }
        this.liveCaptionCandidate = "";
        this.liveCaptionCandidateSince = now;
        return;
      }
      this.liveBlankSince = 0;

      if (displayedText !== this.liveCaptionCandidate) {
        this.liveCaptionCandidate = displayedText;
        this.liveCaptionCandidateSince = now;
        if (this.liveCaptionStableMs > 0) return;
      }
      if (now - this.liveCaptionCandidateSince < this.liveCaptionStableMs) return;
      if (displayedText === this.liveLastSpokenText) return;

      let spokenText = displayedText;
      if (this.liveLastSpokenText && displayedText.startsWith(this.liveLastSpokenText)) {
        spokenText = displayedText.slice(this.liveLastSpokenText.length).trim();
      } else if (this.liveLastSpokenText.includes(displayedText)) {
        return;
      } else if (this.liveLastSpokenText) {
        const previousWords = this.liveLastSpokenText.split(/\s+/);
        const currentWords = displayedText.split(/\s+/);
        let overlap = 0;
        for (
          let size = Math.min(previousWords.length, currentWords.length);
          size > 0;
          size -= 1
        ) {
          const previousSuffix = previousWords.slice(-size).join(" ");
          const currentPrefix = currentWords.slice(0, size).join(" ");
          if (previousSuffix === currentPrefix) {
            overlap = size;
            break;
          }
        }
        if (overlap) spokenText = currentWords.slice(overlap).join(" ");
      }
      if (!spokenText) return;

      this.cancelActiveCue();
      this.liveLastSpokenText = displayedText;
      this.speakLiveCaption(spokenText);
    }

    speakLiveCaption(text) {
      const cueIndex = this.liveSequence++;
      const cue = {
        startMs: Number(this.video?.currentTime || 0) * 1000,
        durationMs: 0,
        text
      };
      const token = ++this.utteranceToken;
      const utterance = new this.Utterance(text);
      const videoRate = Number(this.video?.playbackRate) || 1;
      utterance.rate = clamp(this.settings.rate * videoRate, 0.5, 4);
      utterance.volume = this.settings.volume;
      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      } else {
        utterance.lang = "vi-VN";
      }

      this.activeCueIndex = cueIndex;
      this.index = cueIndex;
      utterance.onstart = () => {
        if (!this.isCurrentLiveUtterance(token, cueIndex)) return;
        this.onCue({ cue, index: cueIndex });
        this.emitState({ waitingForCue: false });
      };
      utterance.onend = () => {
        if (!this.isCurrentLiveUtterance(token, cueIndex)) return;
        this.emitState({ waitingForCue: true });
      };
      utterance.onerror = (event) => {
        if (!this.isCurrentLiveUtterance(token, cueIndex)) return;
        this.failTimeline(event?.error || "speech-error");
      };
      this.speechSynthesis.speak(utterance);
    }

    isCurrentLiveUtterance(token, cueIndex) {
      return (
        this.mode === "live" &&
        this.status === "speaking" &&
        token === this.utteranceToken &&
        cueIndex === this.activeCueIndex
      );
    }

    findCueIndexAt(timeMs) {
      let low = 0;
      let high = this.queue.length - 1;
      let candidate = -1;

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const startMs = Number(this.queue[middle]?.startMs) || 0;
        if (startMs <= timeMs) {
          candidate = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      if (candidate < 0) {
        return -1;
      }

      const cue = this.queue[candidate];
      const startMs = Number(cue.startMs) || 0;
      const durationMs = Number(cue.durationMs);
      const nextStartMs = Number(this.queue[candidate + 1]?.startMs);
      let endMs = Number.isFinite(durationMs) && durationMs > 0
        ? startMs + durationMs
        : startMs + 3000;

      if (Number.isFinite(nextStartMs) && nextStartMs > startMs) {
        endMs = Math.min(endMs, nextStartMs);
      }

      return timeMs >= startMs && timeMs < endMs ? candidate : -1;
    }

    speakTimelineCue(cueIndex) {
      const cue = this.queue[cueIndex];
      let spokenCue = cue;
      if (this.timelineTextProvider) {
        let displayedText = "";
        try {
          displayedText = String(
            this.timelineTextProvider({ cue, index: cueIndex, video: this.video }) || ""
          ).trim();
        } catch (error) {
          displayedText = "";
        }
        if (!displayedText) {
          return;
        }
        spokenCue = { ...cue, text: displayedText };
      }

      const token = ++this.utteranceToken;
      const utterance = new this.Utterance(spokenCue.text);
      const videoRate = Number(this.video?.playbackRate) || 1;
      utterance.rate = clamp(this.settings.rate * videoRate, 0.5, 4);
      utterance.volume = this.settings.volume;
      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      } else {
        utterance.lang = "vi-VN";
      }

      this.activeCueIndex = cueIndex;
      this.index = cueIndex;
      utterance.onstart = () => {
        if (!this.isCurrentTimelineUtterance(token, cueIndex)) {
          return;
        }
        this.onCue({ cue: spokenCue, index: cueIndex });
        this.emitState({ waitingForCue: false });
      };
      utterance.onend = () => {
        if (!this.isCurrentTimelineUtterance(token, cueIndex)) {
          return;
        }
        this.emitState({ waitingForCue: true });
      };
      utterance.onerror = (event) => {
        if (!this.isCurrentTimelineUtterance(token, cueIndex)) {
          return;
        }
        this.failTimeline(event?.error || "speech-error");
      };

      this.speechSynthesis.speak(utterance);
    }

    isCurrentTimelineUtterance(token, cueIndex) {
      return (
        this.mode === "timeline" &&
        this.status === "speaking" &&
        token === this.utteranceToken &&
        cueIndex === this.activeCueIndex
      );
    }

    cancelActiveCue() {
      this.utteranceToken += 1;
      if (this.activeCueIndex >= 0) {
        this.speechSynthesis.cancel();
      }
      this.activeCueIndex = -1;
    }

    finishTimeline() {
      this.runId += 1;
      this.utteranceToken += 1;
      this.detachTimeline();
      this.speechSynthesis.cancel();
      this.speechSynthesis.resume();
      this.index = 0;
      this.activeCueIndex = -1;
      this.videoWasPaused = false;
      this.status = "stopped";
      this.mode = "sequential";
      this.timelineTextProvider = null;
      this.liveCaptionProvider = null;
      this.emitState({ completed: true });
    }

    failTimeline(error) {
      this.runId += 1;
      this.utteranceToken += 1;
      this.detachTimeline();
      this.activeCueIndex = -1;
      this.videoWasPaused = false;
      this.status = "stopped";
      this.mode = "sequential";
      this.timelineTextProvider = null;
      this.liveCaptionProvider = null;
      this.emitState({ error });
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
