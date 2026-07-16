"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "extension");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const requiredPaths = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => entry.js || [])
].filter(Boolean);

const missing = [...new Set(requiredPaths)].filter((item) => !fs.existsSync(path.join(root, item)));
if (missing.length) {
  console.error(`Missing files referenced by manifest.json:\n${missing.join("\n")}`);
  process.exitCode = 1;
} else {
  const invalidIcons = Object.entries(manifest.icons || {}).filter(([expectedSize, relativePath]) => {
    const data = fs.readFileSync(path.join(root, relativePath));
    const pngSignature = data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const width = pngSignature ? data.readUInt32BE(16) : 0;
    const height = pngSignature ? data.readUInt32BE(20) : 0;
    return width !== Number(expectedSize) || height !== Number(expectedSize);
  });
  if (invalidIcons.length) {
    console.error(`Invalid PNG icon dimensions: ${invalidIcons.map(([, item]) => item).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const htmlPages = [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean);
  const inlineScripts = htmlPages.filter((relativePath) =>
    /<script(?![^>]*\bsrc=)[^>]*>/i.test(fs.readFileSync(path.join(root, relativePath), "utf8"))
  );
  if (inlineScripts.length) {
    console.error(`Inline scripts violate the extension CSP: ${inlineScripts.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Manifest ${manifest.version} is valid; ${new Set(requiredPaths).size} referenced files and all icon dimensions passed.`
  );
}
