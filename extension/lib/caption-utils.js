(function initialiseCaptionUtils(root, factory) {
  "use strict";

  const api = factory();
  root.YtTtsCaptionUtils = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(globalThis, function createCaptionUtils() {
  "use strict";

  function decodeEntities(value) {
    const named = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"'
    };

    return String(value || "").replace(
      /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
      (entity, key) => {
        if (key[0] === "#") {
          const hexadecimal = key[1]?.toLowerCase() === "x";
          const number = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
          return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
        }

        return named[key.toLowerCase()] ?? entity;
      }
    );
  }

  function cleanCaptionText(value) {
    return decodeEntities(value)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripMarkup(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/s>/gi, " ")
      .replace(/<[^>]*>/g, "");
  }

  function parseJson3(payload) {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    const events = Array.isArray(parsed?.events) ? parsed.events : [];

    return events
      .map((event) => {
        const segments = Array.isArray(event?.segs) ? event.segs : [];
        const text = cleanCaptionText(segments.map((segment) => segment?.utf8 || "").join(""));
        const startMs = Number(event?.tStartMs);
        const durationMs = Number(event?.dDurationMs);

        if (!text || !Number.isFinite(startMs)) {
          return null;
        }

        return {
          startMs,
          durationMs: Number.isFinite(durationMs) ? durationMs : 0,
          text
        };
      })
      .filter(Boolean);
  }

  function readXmlAttribute(attributes, name) {
    const match = String(attributes).match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
    return match?.[1];
  }

  function parseXml(payload) {
    const cues = [];
    const elementPattern = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = elementPattern.exec(String(payload || "")))) {
      const attributes = match[2];
      const startSeconds = Number(readXmlAttribute(attributes, "start"));
      const startMilliseconds = Number(readXmlAttribute(attributes, "t"));
      const durationSeconds = Number(readXmlAttribute(attributes, "dur"));
      const durationMilliseconds = Number(readXmlAttribute(attributes, "d"));
      const startMs = Number.isFinite(startSeconds)
        ? startSeconds * 1000
        : startMilliseconds;
      const durationMs = Number.isFinite(durationSeconds)
        ? durationSeconds * 1000
        : Number.isFinite(durationMilliseconds)
          ? durationMilliseconds
          : 0;
      const text = cleanCaptionText(stripMarkup(match[3]));

      if (text && Number.isFinite(startMs)) {
        cues.push({ startMs, durationMs, text });
      }
    }

    return cues;
  }

  function parseTranscriptPayload(payload) {
    const text = String(payload || "").trim();
    if (!text) {
      return [];
    }

    if (text.startsWith("{")) {
      try {
        return parseJson3(text);
      } catch (error) {
        // Some timedtext responses report an inaccurate content type. Try XML below.
      }
    }

    return parseXml(text);
  }

  function getRenderer(playerResponse) {
    return playerResponse?.captions?.playerCaptionsTracklistRenderer || null;
  }

  function extractBalancedJson(source, marker) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }

    const start = source.indexOf("{", markerIndex + marker.length);
    if (start < 0) {
      return null;
    }

    let depth = 0;
    let quote = "";
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const character = source[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, index + 1);
        }
      }
    }

    return null;
  }

  function parsePlayerResponseScripts(scriptTexts, currentVideoId = "") {
    const markers = [
      "ytInitialPlayerResponse =",
      "ytInitialPlayerResponse=",
      '"playerResponse":'
    ];
    const candidates = [];

    for (const source of scriptTexts || []) {
      for (const marker of markers) {
        let offset = 0;
        let match;

        while ((match = extractBalancedJson(String(source).slice(offset), marker))) {
          try {
            const response = JSON.parse(match);
            if (getRenderer(response)) {
              candidates.push(response);
            }
          } catch (error) {
            // Continue scanning other script blocks when YouTube changes an inline blob.
          }

          const position = String(source).indexOf(match, offset);
          offset = position < 0 ? String(source).length : position + match.length;
        }
      }
    }

    return (
      candidates.find((candidate) => candidate?.videoDetails?.videoId === currentVideoId) ||
      candidates[0] ||
      null
    );
  }

  function getTrackName(track) {
    return (
      track?.name?.simpleText ||
      track?.name?.runs?.map((run) => run?.text || "").join("") ||
      track?.languageCode ||
      "Không rõ"
    );
  }

  function normaliseTrack(track) {
    return {
      baseUrl: String(track?.baseUrl || ""),
      languageCode: String(track?.languageCode || ""),
      kind: String(track?.kind || ""),
      name: getTrackName(track),
      isTranslatable: Boolean(track?.isTranslatable),
      isDefault: Boolean(track?.isDefault)
    };
  }

  function isVietnamese(languageCode) {
    return String(languageCode || "").toLowerCase().split("-")[0] === "vi";
  }

  function selectCaptionTrack(tracks, preferVietnamese = true) {
    const available = (tracks || []).map(normaliseTrack).filter((track) => track.baseUrl);
    if (!available.length) {
      return null;
    }

    function preferManual(left, right) {
      const leftScore = (left.kind === "asr" ? 0 : 2) + (left.isDefault ? 1 : 0);
      const rightScore = (right.kind === "asr" ? 0 : 2) + (right.isDefault ? 1 : 0);
      return rightScore - leftScore;
    }

    if (preferVietnamese) {
      const vietnamese = available.filter((track) => isVietnamese(track.languageCode));
      if (vietnamese.length) {
        return vietnamese.sort(preferManual)[0];
      }
    }

    return available.sort(preferManual)[0];
  }

  function makeTimedTextUrl(baseUrl) {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    return url.toString();
  }

  return {
    cleanCaptionText,
    decodeEntities,
    extractBalancedJson,
    getRenderer,
    isVietnamese,
    makeTimedTextUrl,
    normaliseTrack,
    parseJson3,
    parsePlayerResponseScripts,
    parseTranscriptPayload,
    parseXml,
    selectCaptionTrack
  };
});
