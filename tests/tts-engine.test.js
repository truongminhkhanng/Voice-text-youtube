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
