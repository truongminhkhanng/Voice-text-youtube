"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TtsEngine, selectVoice } = require("../extension/lib/tts-engine.js");

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

function createSynth() {
  return {
    spoken: [],
    paused: false,
    cancelled: 0,
    speak(utterance) {
      this.spoken.push(utterance);
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    cancel() {
      this.cancelled += 1;
    }
  };
}

function createVideo() {
  return {
    currentTime: 0,
    playbackRate: 1,
    paused: false,
    ended: false,
    addEventListener() {},
    removeEventListener() {}
  };
}

test("selectVoice defaults only to a Vietnamese voice", () => {
  const voices = [
    { voiceURI: "en", lang: "en-US" },
    { voiceURI: "vi", lang: "vi-VN" }
  ];

  assert.equal(selectVoice(voices).voiceURI, "vi");
  assert.equal(selectVoice([voices[0]]), null);
  assert.equal(selectVoice(voices, "en").voiceURI, "en");
});

test("TtsEngine reads every cue in sequence", () => {
  const synth = createSynth();
  const states = [];
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    onState: (state) => states.push(state)
  });
  engine.configure({ rate: 1.25, volume: 0.6 });
  engine.setQueue([{ text: "Một" }, { text: "Hai" }]);
  engine.play({ voiceURI: "vi", lang: "vi-VN" });

  assert.equal(synth.spoken[0].text, "Một");
  assert.equal(synth.spoken[0].rate, 1.25);
  synth.spoken[0].onend();
  assert.equal(synth.spoken[1].text, "Hai");
  synth.spoken[1].onend();
  assert.equal(states.at(-1).completed, true);
  assert.equal(states.at(-1).playback, "stopped");
});

test("TtsEngine pause/resume preserves the queue position and stop resets it", () => {
  const synth = createSynth();
  const engine = new TtsEngine({ speechSynthesis: synth, Utterance: FakeUtterance });
  engine.setQueue([{ text: "Một" }]);
  engine.play({ voiceURI: "vi", lang: "vi-VN" });
  engine.pause();
  assert.equal(engine.status, "paused");
  engine.play();
  assert.equal(engine.status, "speaking");
  assert.equal(synth.spoken.length, 1);
  engine.stop();
  assert.equal(engine.index, 0);
  assert.equal(engine.status, "stopped");
});

test("TtsEngine follows video timestamps and never reads the next cue early", () => {
  const synth = createSynth();
  const cues = [];
  const video = createVideo();
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    timelineIntervalMs: 60_000,
    onCue: ({ index }) => cues.push(index)
  });
  engine.setQueue([
    { startMs: 1000, durationMs: 500, text: "Một" },
    { startMs: 2500, durationMs: 700, text: "Hai" }
  ]);
  engine.playTimeline(video, { voiceURI: "vi", lang: "vi-VN" });

  assert.equal(synth.spoken.length, 0, "must wait until the first subtitle starts");

  video.currentTime = 1;
  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, "Một");
  synth.spoken[0].onstart();
  synth.spoken[0].onend();
  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 1, "must not replay or advance while the same cue is active");

  video.currentTime = 1.6;
  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 1, "must stay silent in a subtitle gap");

  video.currentTime = 2.5;
  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 2);
  assert.equal(synth.spoken[1].text, "Hai");

  video.paused = true;
  engine.syncToTimeline();
  assert.equal(synth.paused, true, "video pause must pause speech synthesis");

  video.paused = false;
  video.currentTime = 1.1;
  engine.syncToTimeline();
  assert.equal(synth.paused, false);
  assert.equal(synth.spoken.length, 3, "seeking must read the cue at the new video position");
  assert.equal(synth.spoken[2].text, "Một");
  assert.deepEqual(cues, [0]);

  engine.stop();
  assert.equal(synth.paused, false, "stop must leave speech synthesis ready for the next play");
});

test("TtsEngine can read the translated caption currently displayed by YouTube", () => {
  const synth = createSynth();
  const spokenCues = [];
  const video = createVideo();
  let displayedCaption = "";
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    timelineIntervalMs: 60_000,
    onCue: ({ cue }) => spokenCues.push(cue.text)
  });
  engine.setQueue([
    { startMs: 0, durationMs: 2000, text: "that you create inside your design in Bricks." }
  ]);
  engine.playTimeline(
    video,
    { voiceURI: "vi", lang: "vi-VN" },
    () => displayedCaption
  );

  assert.equal(synth.spoken.length, 0, "must wait when YouTube has not rendered the caption yet");

  displayedCaption = "mà bạn tạo trong thiết kế của mình trên Bricks.";
  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, displayedCaption);
  synth.spoken[0].onstart();
  assert.deepEqual(spokenCues, [displayedCaption]);

  engine.stop();
});

test("TtsEngine stops synchronized playback when the video ends", () => {
  const synth = createSynth();
  const states = [];
  const video = createVideo();
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    timelineIntervalMs: 60_000,
    onState: (state) => states.push(state)
  });
  engine.setQueue([{ startMs: 0, durationMs: 1000, text: "Một" }]);
  engine.playTimeline(video, { voiceURI: "vi", lang: "vi-VN" });
  video.ended = true;
  engine.syncToTimeline();

  assert.equal(engine.status, "stopped");
  assert.equal(states.at(-1).completed, true);
});

test("TtsEngine reads live YouTube captions only after they appear", () => {
  const synth = createSynth();
  const video = createVideo();
  let displayedCaption = "";
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    timelineIntervalMs: 60_000,
    liveCaptionStableMs: 0
  });
  engine.configure({ rate: 1.4, volume: 0.7 });
  engine.playLiveCaptions(
    video,
    { voiceURI: "vi", lang: "vi-VN" },
    () => displayedCaption
  );

  assert.equal(synth.spoken.length, 0, "must stay silent before YouTube renders a caption");

  displayedCaption = "Xin chào các bạn";
  video.currentTime = 2.5;
  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, displayedCaption);
  assert.equal(synth.spoken[0].rate, 1.4);

  engine.syncToTimeline();
  assert.equal(synth.spoken.length, 1, "must not repeat the same displayed caption");
  engine.stop();
});

test("TtsEngine supports speech rates up to 4x in synchronized modes", () => {
  const synth = createSynth();
  const video = createVideo();
  let displayedCaption = "Đọc nhanh hơn";
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    timelineIntervalMs: 60_000,
    liveCaptionStableMs: 0
  });
  engine.configure({ rate: 4, volume: 0.8 });
  engine.playLiveCaptions(video, { voiceURI: "vi", lang: "vi-VN" }, () => displayedCaption);

  assert.equal(synth.spoken[0].rate, 4);
  engine.stop();

  displayedCaption = "";
  video.playbackRate = 2;
  engine.configure({ rate: 3, volume: 0.8 });
  engine.setQueue([{ startMs: 0, durationMs: 1000, text: "Giữ giới hạn bốn lần" }]);
  engine.playTimeline(video, { voiceURI: "vi", lang: "vi-VN" });
  assert.equal(synth.spoken.at(-1).rate, 4, "video rate multiplication must cap at 4x");
  engine.stop();
});

test("TtsEngine reads only appended words when live automatic captions grow", () => {
  const synth = createSynth();
  const video = createVideo();
  let displayedCaption = "Xin chào";
  const engine = new TtsEngine({
    speechSynthesis: synth,
    Utterance: FakeUtterance,
    timelineIntervalMs: 60_000,
    liveCaptionStableMs: 0
  });
  engine.playLiveCaptions(video, { voiceURI: "vi", lang: "vi-VN" }, () => displayedCaption);
  assert.equal(synth.spoken[0].text, "Xin chào");

  displayedCaption = "Xin chào các bạn";
  engine.syncToTimeline();
  assert.equal(synth.spoken[1].text, "các bạn");

  displayedCaption = "các bạn đến với video";
  engine.syncToTimeline();
  assert.equal(synth.spoken[2].text, "đến với video", "must skip words retained by a rolling caption");
  engine.stop();
});
