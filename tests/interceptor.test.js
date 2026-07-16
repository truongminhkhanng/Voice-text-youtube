"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCaptureStore,
  install,
  parseTimedTextUrl
} = require("../extension/interceptor.js");

test("parseTimedTextUrl recognises YouTube PO-token caption resources", () => {
  assert.deepEqual(
    parseTimedTextUrl(
      "https://www.youtube.com/api/timedtext?v=video123&lang=en&tlang=vi&pot=token-value"
    ),
    {
      videoId: "video123",
      languageCode: "vi",
      hasPoToken: true,
      url: "https://www.youtube.com/api/timedtext?v=video123&lang=en&tlang=vi&pot=token-value"
    }
  );
  assert.equal(parseTimedTextUrl("https://www.youtube.com/watch?v=video123"), null);
});

test("caption capture store keeps newest unique resources per video", () => {
  const store = createCaptureStore(2);
  store.add("https://www.youtube.com/api/timedtext?v=a&lang=en&pot=one");
  store.add("https://www.youtube.com/api/timedtext?v=a&lang=vi&pot=two");
  store.add("https://www.youtube.com/api/timedtext?v=a&lang=fr&pot=three");
  store.add("https://www.youtube.com/api/timedtext?v=b&lang=en&pot=other");

  assert.deepEqual(store.list("a").map((item) => item.languageCode), ["fr", "vi"]);
  assert.equal(store.list("b").length, 1);
});

test("interceptor records the final XMLHttpRequest response URL without changing the request", () => {
  class FakeXhr {
    listeners = new Map();
    responseURL = "";

    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }

    open(method, url) {
      this.method = method;
      this.openedUrl = url;
    }

    send(body) {
      this.body = body;
      this.listeners.get("loadend")?.();
    }
  }

  const fakeWindow = { XMLHttpRequest: FakeXhr };
  const capture = install(fakeWindow);
  const xhr = new fakeWindow.XMLHttpRequest();
  const requestedUrl = "https://www.youtube.com/api/timedtext?v=video456&lang=en";
  const finalUrl = `${requestedUrl}&pot=redirected-token`;
  xhr.open("GET", requestedUrl);
  xhr.responseURL = finalUrl;
  xhr.send(null);

  assert.equal(xhr.openedUrl, requestedUrl);
  assert.equal(xhr.method, "GET");
  assert.equal(capture.list("video456")[0].url, finalUrl);
});
