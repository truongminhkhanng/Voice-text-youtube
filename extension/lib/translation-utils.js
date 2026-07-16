(function initialiseTranslationUtils(root, factory) {
  "use strict";

  const api = factory();
  root.YtTtsTranslationUtils = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(globalThis, function createTranslationUtils() {
  "use strict";

  function createBatches(texts, maximumItems = 100, maximumCharacters = 25000) {
    const batches = [];
    let batch = [];
    let characterCount = 0;

    for (const rawText of texts || []) {
      const text = String(rawText);
      const wouldOverflow =
        batch.length > 0 &&
        (batch.length >= maximumItems || characterCount + text.length > maximumCharacters);

      if (wouldOverflow) {
        batches.push(batch);
        batch = [];
        characterCount = 0;
      }

      batch.push(text);
      characterCount += text.length;
    }

    if (batch.length) {
      batches.push(batch);
    }

    return batches;
  }

  function validateTexts(texts) {
    if (!Array.isArray(texts) || !texts.length) {
      throw new Error("Không có nội dung cần dịch.");
    }
    if (texts.length > 10000) {
      throw new Error("Video có quá nhiều câu phụ đề để dịch trong một lần.");
    }

    let totalCharacters = 0;
    const clean = texts.map((value) => {
      if (typeof value !== "string" || value.length > 5000) {
        throw new Error("Một câu phụ đề không hợp lệ hoặc quá dài.");
      }
      totalCharacters += value.length;
      return value;
    });

    if (totalCharacters > 500000) {
      throw new Error("Phụ đề vượt quá giới hạn 500.000 ký tự cho một lần dịch.");
    }
    return clean;
  }

  return { createBatches, validateTexts };
});
