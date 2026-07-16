"use strict";

const fs = require("node:fs");
const path = require("node:path");

function validateManifest(packageRoot, label) {
  const manifestPath = path.join(packageRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${label}: manifest.json is missing.`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.manifest_version !== 3) {
    throw new Error(`${label}: manifest_version must be 3.`);
  }

  const requiredPaths = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || [])
  ].filter(Boolean);
  const uniquePaths = [...new Set(requiredPaths)];
  const missing = uniquePaths.filter((item) => !fs.existsSync(path.join(packageRoot, item)));
  if (missing.length) {
    throw new Error(`${label}: missing files referenced by manifest.json:\n${missing.join("\n")}`);
  }

  const invalidIcons = Object.entries(manifest.icons || {}).filter(([expectedSize, relativePath]) => {
    const data = fs.readFileSync(path.join(packageRoot, relativePath));
    const pngSignature = data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const width = pngSignature ? data.readUInt32BE(16) : 0;
    const height = pngSignature ? data.readUInt32BE(20) : 0;
    return width !== Number(expectedSize) || height !== Number(expectedSize);
  });
  if (invalidIcons.length) {
    throw new Error(
      `${label}: invalid PNG icon dimensions: ${invalidIcons.map(([, item]) => item).join(", ")}`
    );
  }

  const htmlPages = [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean);
  const inlineScripts = htmlPages.filter((relativePath) =>
    /<script(?![^>]*\bsrc=)[^>]*>/i.test(
      fs.readFileSync(path.join(packageRoot, relativePath), "utf8")
    )
  );
  if (inlineScripts.length) {
    throw new Error(`${label}: inline scripts violate extension CSP: ${inlineScripts.join(", ")}`);
  }

  const workerPath = path.join(packageRoot, manifest.background.service_worker);
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const workerDirectory = path.dirname(workerPath);
  const imports = [...workerSource.matchAll(/importScripts\(([^)]+)\)/g)]
    .flatMap((match) => [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]));
  const missingImports = imports.filter((item) => !fs.existsSync(path.resolve(workerDirectory, item)));
  if (missingImports.length) {
    throw new Error(`${label}: missing service-worker imports: ${missingImports.join(", ")}`);
  }

  console.log(
    `${label}: Manifest ${manifest.version} is valid; ${uniquePaths.length} referenced files, worker imports and icons passed.`
  );
}

try {
  const workspace = path.resolve(__dirname, "..");
  const requestedRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (requestedRoot) {
    validateManifest(requestedRoot, path.basename(requestedRoot));
  } else {
    validateManifest(workspace, "Repository root");
    validateManifest(path.join(workspace, "extension"), "extension/");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
