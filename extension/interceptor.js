(function initialiseTimedTextInterceptor(root, factory) {
  "use strict";

  const api = factory();
  root.YtTtsTimedTextInterceptor = api;
  api.install(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(globalThis, function createTimedTextInterceptorApi() {
  "use strict";

  const GLOBAL_KEY = "__YT_TTS_TIMEDTEXT_CAPTURE__";
  const REQUEST_URL = new WeakMap();
  const ACTIVE_OBSERVERS = new Set();

  function parseTimedTextUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      if (!url.pathname.endsWith("/api/timedtext")) {
        return null;
      }
      const videoId = url.searchParams.get("v") || "";
      if (!videoId) {
        return null;
      }
      return {
        videoId,
        languageCode: url.searchParams.get("tlang") || url.searchParams.get("lang") || "",
        hasPoToken: url.searchParams.has("pot"),
        url: url.toString()
      };
    } catch (error) {
      return null;
    }
  }

  function createCaptureStore(maximumPerVideo = 16) {
    const byVideo = new Map();

    return {
      add(rawUrl) {
        const captured = parseTimedTextUrl(rawUrl);
        if (!captured) {
          return false;
        }
        const existing = byVideo.get(captured.videoId) || [];
        const withoutDuplicate = existing.filter((item) => item.url !== captured.url);
        withoutDuplicate.unshift(captured);
        byVideo.set(captured.videoId, withoutDuplicate.slice(0, maximumPerVideo));
        return true;
      },
      list(videoId) {
        return (byVideo.get(String(videoId || "")) || []).map((item) => ({ ...item }));
      }
    };
  }

  function install(rootWindow) {
    if (!rootWindow || rootWindow[GLOBAL_KEY]) {
      return rootWindow?.[GLOBAL_KEY] || null;
    }

    const store = createCaptureStore();
    const facade = Object.freeze({
      list: (videoId) => store.list(videoId)
    });
    Object.defineProperty(rootWindow, GLOBAL_KEY, {
      value: facade,
      configurable: false,
      enumerable: false,
      writable: false
    });

    const remember = (rawUrl) => store.add(rawUrl);
    const Xhr = rootWindow.XMLHttpRequest;
    if (Xhr?.prototype?.open && Xhr?.prototype?.send) {
      const originalOpen = Xhr.prototype.open;
      const originalSend = Xhr.prototype.send;

      Xhr.prototype.open = function openWithTimedTextCapture(method, url, ...rest) {
        REQUEST_URL.set(this, String(url || ""));
        return originalOpen.call(this, method, url, ...rest);
      };
      Xhr.prototype.send = function sendWithTimedTextCapture(...args) {
        this.addEventListener(
          "loadend",
          () => remember(this.responseURL || REQUEST_URL.get(this) || ""),
          { once: true }
        );
        return originalSend.apply(this, args);
      };
    }

    if (typeof rootWindow.PerformanceObserver === "function") {
      try {
        const observer = new rootWindow.PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            remember(entry.name);
          }
        });
        observer.observe({ type: "resource", buffered: true });
        ACTIVE_OBSERVERS.add(observer);
      } catch (error) {
        // XHR capture remains available when buffered resource observation is unsupported.
      }
    }

    return facade;
  }

  return { createCaptureStore, install, parseTimedTextUrl };
});
