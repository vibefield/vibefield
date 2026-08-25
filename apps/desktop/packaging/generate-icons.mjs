#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";

const execFileAsync = promisify(execFile);
const packagingRoot = dirname(fileURLToPath(import.meta.url));
const iconRoot = join(packagingRoot, "icons");
const trayRoot = join(packagingRoot, "tray");
const builderConfigPath = join(packagingRoot, "electron-builder.yml");
const appMasterPath = join(iconRoot, "app-master.svg");
const trayMasterPath = join(iconRoot, "tray-master.svg");
const appleIconPath = join(iconRoot, "app.icon");
const appleComposerRenditionPath = join(iconRoot, "app-macos-1024.png");
// The Xcode build that rendered the COMMITTED Icon Composer/actool assets.
// Only this build regenerates them (their output is not byte-stable across
// Xcode releases); every other machine validates the committed bytes.
const APPLE_ICON_TOOLCHAIN_BUILD = "17F113";
const appleFallbackIconPath = join(iconRoot, "app.icns");

const APP_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const APP_LINUX_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512];
const APP_RENDER_SIZES = [...new Set([...APP_ICO_SIZES, ...APP_LINUX_SIZES, 1024])].sort(
  (a, b) => a - b,
);
const TRAY_ICO_SIZES = [16, 20, 24, 32];
const TRAY_STATES = [
  {
    kind: "base",
    mac1x: "fieldTemplate.png",
    mac2x: "fieldTemplate@2x.png",
    windows: "field-ready.ico",
    linux: "field-linux.png",
  },
  {
    kind: "attention",
    mac1x: "fieldAttentionTemplate.png",
    mac2x: "fieldAttentionTemplate@2x.png",
    windows: "field-attention.ico",
    linux: "field-linux-attention.png",
  },
  {
    kind: "offline",
    mac1x: "fieldOfflineTemplate.png",
    mac2x: "fieldOfflineTemplate@2x.png",
    windows: "field-offline.ico",
    linux: "field-linux-offline.png",
  },
];
const APPLE_ICNS_CHUNKS = [
  ["ic13", 256],
  ["ic11", 32],
  ["ic04", 16],
  ["ic07", 128],
];
const STATIC_SOURCE_FILES = new Set([
  "README.md",
  "app-master.svg",
  "app.icon/icon.json",
  "tray-master.svg",
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const args = new Set(process.argv.slice(2));
const checkOnly = args.delete("--check");
if (args.size > 0) {
  throw new Error(`unknown icon generator option(s): ${[...args].join(", ")}`);
}

const [appMaster, trayMaster, builderConfig, appleIconDefinition] = await Promise.all([
  readFile(appMasterPath, "utf8"),
  readFile(trayMasterPath, "utf8"),
  readFile(builderConfigPath, "utf8"),
  readFile(join(appleIconPath, "icon.json"), "utf8"),
]);
assertSquareMaster(appMaster, "application");
assertSquareMaster(trayMaster, "tray");
assertBuilderIconConfig(builderConfig);
const appPaths = extractPaths(appMaster);
if (appPaths.length !== 2) {
  throw new Error(
    `application master must contain background + mark paths; found ${appPaths.length}`,
  );
}
const appMarkPath = appPaths[1];
const appleIconSourceFiles = await validateAppleIconSource(appleIconDefinition);
const trayPath = extractSinglePath(trayMaster);
const appleAssets = await compileAppleIconAssets();
const generated = generateAssets({ appMaster, appMarkPath, trayPath, ...appleAssets });

if (!checkOnly) {
  for (const [path, asset] of generated.outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, asset);
  }
}

await validateGeneratedTree({
  outputs: generated.outputs,
  sourceFiles: new Set([...STATIC_SOURCE_FILES, ...appleIconSourceFiles]),
});
console.log(
  `icons ${checkOnly ? "current" : "generated"}: ${generated.outputs.size} files, app ${APP_RENDER_SIZES.length} conventional raster sizes, official macOS ICNS fallback, tray 3 states`,
);

function generateAssets({
  appMaster,
  appMarkPath,
  trayPath,
  appleComposerRendition,
  appleFallbackIcns,
}) {
  const outputs = new Map();
  const pngs = new Map();
  const appImages = new Map();
  const { developmentDockIcon } = validateAppleFallbackIcns(appleFallbackIcns);

  for (const size of APP_RENDER_SIZES) {
    const image = render(applicationSvg(appMaster, appMarkPath, size), size);
    assertApplicationPixels(image, size);
    appImages.set(size, image);
  }

  addPng("icons/app-1024.png", appImages.get(1024));
  add("icons/app-macos-1024.png", appleComposerRendition);
  add("icons/app-macos-dock.png", developmentDockIcon);
  for (const size of APP_LINUX_SIZES) {
    addPng(`icons/linux/${size}x${size}.png`, appImages.get(size));
  }

  const appIco = encodeIco(APP_ICO_SIZES.map((size) => appImages.get(size)));
  add("icons/app.ico", appIco);
  add("icons/app.icns", appleFallbackIcns);
  // Keep both conventional ICNS paths visually aligned with the Icon Composer
  // source for consumers that cannot read Assets.car or app.icon directly.
  add("icon.icns", appleFallbackIcns);

  const statePngs = new Map();
  for (const state of TRAY_STATES) {
    const templateSvg = traySvg(trayPath, state.kind, "template");
    const mac1x = render(templateSvg, 16);
    const mac2x = render(templateSvg, 32);
    assertTemplatePixels(mac1x, `${state.kind} 1x`);
    assertTemplatePixels(mac2x, `${state.kind} 2x`);
    addPng(`tray/${state.mac1x}`, mac1x);
    addPng(`tray/${state.mac2x}`, mac2x);

    const dualSvg = traySvg(trayPath, state.kind, "dual-tone");
    const windows = TRAY_ICO_SIZES.map((size) => render(dualSvg, size));
    for (const image of windows) assertDualTonePixels(image, `${state.kind} ${image.width}px`);
    add(`tray/${state.windows}`, encodeIco(windows));
    const linux = render(dualSvg, 32);
    assertDualTonePixels(linux, `${state.kind} Linux`);
    addPng(`tray/${state.linux}`, linux);
    statePngs.set(state.kind, { mac1x, mac2x, linux });
  }

  for (const family of ["mac1x", "mac2x", "linux"]) {
    const hashes = new Set(
      TRAY_STATES.map((state) => digest(statePngs.get(state.kind)[family].png)),
    );
    if (hashes.size !== TRAY_STATES.length) {
      throw new Error(`tray ${family} state variants are not visually distinct`);
    }
  }

  validateIco(appIco, APP_ICO_SIZES, "application ICO");
  for (const state of TRAY_STATES) {
    validateIco(
      outputs.get(join(packagingRoot, "tray", state.windows)),
      TRAY_ICO_SIZES,
      `${state.kind} tray ICO`,
    );
  }

  return { outputs, pngs };

  function add(relativePath, buffer) {
    const path = join(packagingRoot, relativePath);
    if (outputs.has(path)) throw new Error(`duplicate generated asset: ${relativePath}`);
    outputs.set(path, buffer);
  }

  function addPng(relativePath, image) {
    validatePng(image.png, image.width, image.height, relativePath);
    add(relativePath, image.png);
    pngs.set(join(packagingRoot, relativePath), image);
  }
}

async function compileAppleIconAssets() {
  // Check mode NEVER invokes the Apple toolchain: Icon Composer's render is
  // not byte-stable across machines even at the IDENTICAL Xcode build (CI
  // run 30879428413: a 17F113 runner re-rendered 17F113-authored assets to
  // different bytes — the OS rendering stack is part of the output). The
  // committed bytes are the truth everywhere; re-rendering is exclusively
  // the deliberate `icons:generate` act on the authoring machine.
  const toolchain = checkOnly ? null : await findAppleIconToolchain();
  if (toolchain === null) {
    let committed;
    try {
      const [appleComposerRendition, appleFallbackIcns] = await Promise.all([
        readFile(appleComposerRenditionPath),
        readFile(appleFallbackIconPath),
      ]);
      committed = { appleComposerRendition, appleFallbackIcns };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          "the committed macOS PNG or ICNS fallback is missing and can only be generated with Xcode 26 on macOS",
        );
      }
      throw error;
    }
    validateAppleComposerRendition(committed.appleComposerRendition);
    validateAppleFallbackIcns(committed.appleFallbackIcns);
    console.warn(
      checkOnly
        ? "check mode validates the committed macOS PNG and ICNS as-is; re-rendering them is icons:generate's act"
        : "Xcode Icon Composer and actool are unavailable; validated the committed macOS PNG and ICNS without regenerating them",
    );
    return committed;
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "vibefield-icon-composer-"));
  const dockOutputPath = join(temporaryRoot, "app-macos-1024.png");
  const compiledOutputRoot = join(temporaryRoot, "compiled");
  const partialInfoPath = join(temporaryRoot, "partial-info.plist");
  try {
    await mkdir(compiledOutputRoot);
    const options = {
      env: { ...process.env, DEVELOPER_DIR: toolchain.developerDir },
      maxBuffer: 4 * 1024 * 1024,
    };
    await Promise.all([
      execFileAsync(
        toolchain.iconComposer,
        [
          appleIconPath,
          "--export-image",
          "--output-file",
          dockOutputPath,
          "--platform",
          "macOS",
          "--rendition",
          "Default",
          "--width",
          "1024",
          "--height",
          "1024",
          "--scale",
          "1",
          "--light-angle",
          "-45",
        ],
        options,
      ),
      execFileAsync(
        toolchain.actool,
        [
          "--compile",
          compiledOutputRoot,
          "--platform",
          "macosx",
          "--minimum-deployment-target",
          "11.0",
          "--app-icon",
          "app",
          "--include-all-app-icons",
          "--output-partial-info-plist",
          partialInfoPath,
          appleIconPath,
        ],
        options,
      ),
    ]);
    const [appleComposerRendition, appleFallbackIcns] = await Promise.all([
      readFile(dockOutputPath),
      readFile(join(compiledOutputRoot, "app.icns")),
    ]);
    validateAppleComposerRendition(appleComposerRendition);
    validateAppleFallbackIcns(appleFallbackIcns);
    return { appleComposerRendition, appleFallbackIcns };
  } catch (error) {
    const detail = [error?.message, error?.stderr, error?.stdout]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join("\n");
    throw new Error(
      `Xcode could not compile icons/app.icon${detail.length > 0 ? `:\n${detail}` : ""}`,
      { cause: error },
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function findAppleIconToolchain() {
  if (process.platform !== "darwin") return null;

  const developerDirs = [];
  const explicitDeveloperDir = process.env["DEVELOPER_DIR"];
  if (explicitDeveloperDir !== undefined && explicitDeveloperDir.length > 0) {
    developerDirs.push(explicitDeveloperDir);
  } else {
    try {
      const { stdout } = await execFileAsync("xcode-select", ["-p"]);
      if (stdout.trim().length > 0) developerDirs.push(stdout.trim());
    } catch {
      // The standard Xcode location below remains a valid fallback.
    }
  }
  developerDirs.push("/Applications/Xcode.app/Contents/Developer");

  for (const developerDir of new Set(developerDirs)) {
    const candidate = {
      actool: join(developerDir, "usr", "bin", "actool"),
      developerDir,
      iconComposer: resolve(
        developerDir,
        "..",
        "Applications",
        "Icon Composer.app",
        "Contents",
        "Executables",
        "ictool",
      ),
    };
    try {
      await Promise.all([
        access(candidate.iconComposer, fsConstants.X_OK),
        access(candidate.actool, fsConstants.X_OK),
      ]);
      // Only the PINNED Xcode build may regenerate: Icon Composer and actool
      // output are not byte-stable across Xcode releases, so any other build
      // (e.g. a CI runner's) would render honest-but-different bytes and read
      // the committed assets as stale. A different build is treated exactly
      // like an absent toolchain — validate the committed bytes, never
      // regenerate. Upgrading Xcode is a deliberate event: regenerate the
      // assets and move APPLE_ICON_TOOLCHAIN_BUILD in the same commit.
      const { stdout } = await execFileAsync("xcodebuild", ["-version"], {
        env: { ...process.env, DEVELOPER_DIR: candidate.developerDir },
      });
      const build = stdout.match(/Build version (\S+)/)?.[1];
      if (build !== APPLE_ICON_TOOLCHAIN_BUILD) {
        console.warn(
          `Xcode build ${build ?? "unknown"} is not the pinned icon toolchain ` +
            `${APPLE_ICON_TOOLCHAIN_BUILD}; treating it as unavailable`,
        );
        return null;
      }
      return candidate;
    } catch {
      // Try the next full-Xcode installation.
    }
  }
  return null;
}

function render(svg, size) {
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
    logLevel: "off",
  }).render();
  if (rendered.width !== size || rendered.height !== size) {
    throw new Error(
      `renderer produced ${rendered.width}x${rendered.height}; expected ${size}x${size}`,
    );
  }
  return {
    width: rendered.width,
    height: rendered.height,
    pixels: Buffer.from(rendered.pixels),
    png: rendered.asPng(),
  };
}

function decodePng(png, size) {
  return render(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><image width="${size}" height="${size}" preserveAspectRatio="none" href="data:image/png;base64,${png.toString("base64")}"/></svg>`,
    size,
  );
}

function applicationSvg(master, markPath, size) {
  if (size > 64) return master;
  // The reviewed master is intentionally delicate. Direct reduction makes its
  // thinnest section subpixel at 16–64px, so small platform representations
  // receive a constant one-output-pixel optical weight correction.
  const strokeWidth = 480 / size;
  return `<svg width="480" height="480" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="480" fill="#ffffff"/><path d="${markPath}" fill="#212121" stroke="#212121" stroke-width="${strokeWidth}" stroke-linejoin="round"/></svg>`;
}

function traySvg(path, state, style) {
  const template = style === "template";
  const base = template
    ? `<path d="${path}" fill="#000000" stroke="#000000" stroke-width="24" stroke-linejoin="round"/>`
    : `<path d="${path}" fill="#ffffff" stroke="#ffffff" stroke-width="64" stroke-linejoin="round"/><path d="${path}" fill="#202124" stroke="#202124" stroke-width="24" stroke-linejoin="round"/>`;
  const badge =
    state === "base"
      ? ""
      : template
        ? '<circle cx="374" cy="318" r="66" fill="#000000" stroke="#000000" stroke-width="24"/>'
        : '<circle cx="374" cy="318" r="66" fill="#ffffff" stroke="#ffffff" stroke-width="64"/><circle cx="374" cy="318" r="66" fill="#202124" stroke="#202124" stroke-width="24"/>';
  const cutout =
    state === "attention"
      ? '<rect x="365" y="275" width="18" height="51" rx="9" fill="black"/><circle cx="374" cy="346" r="11" fill="black"/>'
      : state === "offline"
        ? '<rect x="341" y="309" width="66" height="18" rx="9" fill="black"/>'
        : "";
  const mask =
    state === "base"
      ? ""
      : `<mask id="status-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="480"><rect width="480" height="480" fill="white"/>${cutout}</mask>`;
  const maskAttribute = state === "base" ? "" : ' mask="url(#status-cutout)"';
  return `<svg width="480" height="480" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg"><defs>${mask}</defs><g${maskAttribute}>${base}${badge}</g></svg>`;
}

function encodeIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = headerSize;
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    header.writeUInt8(image.width === 256 ? 0 : image.width, entry);
    header.writeUInt8(image.height === 256 ? 0 : image.height, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  }
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

function validatePng(buffer, expectedWidth, expectedHeight, label) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a PNG`);
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${label} has no leading IHDR`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${label} is ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`);
  }
  if (colorType !== 6) {
    throw new Error(`${label} must be RGBA PNG color type 6; got ${colorType}`);
  }
}

function validateIco(buffer, expectedSizes, label) {
  if (
    buffer.readUInt16LE(0) !== 0 ||
    buffer.readUInt16LE(2) !== 1 ||
    buffer.readUInt16LE(4) !== expectedSizes.length
  ) {
    throw new Error(`${label} has an invalid ICO header`);
  }
  const sizes = [];
  for (let index = 0; index < expectedSizes.length; index += 1) {
    const entry = 6 + index * 16;
    const width = buffer.readUInt8(entry) || 256;
    const height = buffer.readUInt8(entry + 1) || 256;
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (width !== height)
      throw new Error(`${label} contains a non-square ${width}x${height} frame`);
    validatePng(buffer.subarray(offset, offset + length), width, height, `${label} ${width}px`);
    sizes.push(width);
  }
  if (sizes.join(",") !== expectedSizes.join(",")) {
    throw new Error(`${label} frames are ${sizes.join(",")}; expected ${expectedSizes.join(",")}`);
  }
}

function validateAppleFallbackIcns(buffer) {
  const label = "Icon Composer ICNS fallback";
  if (buffer.toString("ascii", 0, 4) !== "icns" || buffer.readUInt32BE(4) !== buffer.length) {
    throw new Error(`${label} has an invalid ICNS header`);
  }
  const found = [];
  let developmentDockIcon = null;
  let offset = 8;
  while (offset < buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) {
      throw new Error(`${label} has an invalid ${type} chunk length`);
    }
    const expected = APPLE_ICNS_CHUNKS[found.length];
    if (expected === undefined || expected[0] !== type) {
      throw new Error(`${label} contains unexpected representation ${type}`);
    }
    const payload = buffer.subarray(offset + 8, offset + length);
    if (type === "ic04") {
      if (payload.toString("ascii", 0, 4) !== "ARGB") {
        throw new Error(`${label} ${type} is not Apple's legacy ARGB representation`);
      }
    } else {
      validatePng(payload, expected[1], expected[1], `${label} ${type}`);
      if (type === "ic13") {
        const decoded = decodePng(payload, expected[1]);
        validateReviewedApplePixels(decoded, `${label} ${expected[1]}px`);
        validateAppleDockSafeArea(decoded, `${label} ${expected[1]}px`);
        developmentDockIcon = payload;
      }
    }
    found.push(type);
    offset += length;
  }
  if (found.length !== APPLE_ICNS_CHUNKS.length) {
    throw new Error(
      `${label} has ${found.length} representations; expected ${APPLE_ICNS_CHUNKS.length}`,
    );
  }
  if (developmentDockIcon === null) {
    throw new Error(`${label} has no Apple-padded ic13 representation for development`);
  }
  return { developmentDockIcon };
}

function assertSquareMaster(svg, label) {
  if (!/viewBox="0 0 480 480"/.test(svg)) {
    throw new Error(`${label} master must retain the reviewed 480x480 viewBox`);
  }
  if (/<(?:text|image|script|foreignObject)\b/i.test(svg)) {
    throw new Error(`${label} master may contain vector geometry only`);
  }
}

function assertBuilderIconConfig(config) {
  const expected = new Map([
    ["mac", "packaging/icons/app.icon"],
    ["win", "packaging/icons/app.ico"],
    ["linux", "packaging/icons/linux"],
  ]);
  const found = new Map();
  let section = null;
  for (const line of config.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(?:#.*)?$/);
    if (topLevel !== null) {
      section = topLevel[1];
      continue;
    }
    const icon = line.match(/^\s{2}icon:\s*([^#\s]+)\s*(?:#.*)?$/);
    if (icon !== null && section !== null) found.set(section, icon[1]);
  }
  for (const [platform, path] of expected) {
    if (found.get(platform) !== path) {
      throw new Error(
        `electron-builder ${platform}.icon must be ${path}; got ${found.get(platform) ?? "nothing"}`,
      );
    }
  }
}

async function validateAppleIconSource(definition) {
  let parsed;
  try {
    parsed = JSON.parse(definition);
  } catch (error) {
    throw new Error("icons/app.icon/icon.json is not valid JSON", { cause: error });
  }

  if (!Array.isArray(parsed?.groups) || parsed.groups.length === 0) {
    throw new Error("icons/app.icon must contain at least one Icon Composer group");
  }
  if (parsed["supported-platforms"]?.squares !== "shared") {
    throw new Error("icons/app.icon must retain Icon Composer's shared square-platform rendition");
  }
  const fillValues = [
    parsed.fill,
    ...(Array.isArray(parsed["fill-specializations"])
      ? parsed["fill-specializations"].map((specialization) => specialization?.value)
      : []),
  ];
  if (
    !fillValues.some(
      (fill) =>
        typeof fill?.["automatic-gradient"] === "string" && fill["automatic-gradient"].length > 0,
    )
  ) {
    throw new Error(
      "icons/app.icon must retain at least one automatic Icon Composer material fill",
    );
  }

  const referencedAssets = new Set();
  for (const [groupIndex, group] of parsed.groups.entries()) {
    if (!Array.isArray(group?.layers) || group.layers.length === 0) {
      throw new Error(`icons/app.icon group ${groupIndex + 1} must contain at least one layer`);
    }
    for (const [layerIndex, layer] of group.layers.entries()) {
      const label = `icons/app.icon group ${groupIndex + 1} layer ${layerIndex + 1}`;
      const imageName = layer?.["image-name"];
      if (
        typeof imageName !== "string" ||
        imageName.length === 0 ||
        basename(imageName) !== imageName ||
        extname(imageName).toLowerCase() !== ".svg"
      ) {
        throw new Error(`${label} must reference a local SVG asset by filename`);
      }
      if (typeof layer.name !== "string" || layer.name.length === 0) {
        throw new Error(`${label} must retain its Icon Composer layer name`);
      }
      if (layer.position !== undefined) {
        const { scale, ["translation-in-points"]: translation } = layer.position;
        if (
          (scale !== undefined && (!Number.isFinite(scale) || scale <= 0)) ||
          (translation !== undefined &&
            (!Array.isArray(translation) ||
              translation.length !== 2 ||
              !translation.every(Number.isFinite)))
        ) {
          throw new Error(`${label} has an invalid Icon Composer position`);
        }
      }
      referencedAssets.add(imageName);
    }
  }

  const assetsRoot = join(appleIconPath, "Assets");
  const expectedAssets = [...referencedAssets].sort();
  const actualAssets = (await listFiles(assetsRoot)).sort();
  if (actualAssets.join("\n") !== expectedAssets.join("\n")) {
    throw new Error(
      `icons/app.icon Assets must exactly match the referenced SVG layers; expected ${expectedAssets.join(", ")}, found ${actualAssets.join(", ")}`,
    );
  }

  await Promise.all(
    expectedAssets.map(async (asset) => {
      const svg = await readFile(join(assetsRoot, asset), "utf8");
      assertLayerSvg(svg, `Apple layer ${asset}`);
    }),
  );
  return expectedAssets.map((asset) => `app.icon/Assets/${asset}`);
}

function assertLayerSvg(svg, label) {
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (root === null) {
    throw new Error(`${label} must contain an SVG root`);
  }
  const width = parseSvgDimension(readSvgAttribute(root[1], "width"));
  const height = parseSvgDimension(readSvgAttribute(root[1], "height"));
  const viewBox = readSvgAttribute(root[1], "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    width === undefined ||
    height === undefined ||
    width !== height ||
    viewBox?.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    viewBox[2] <= 0 ||
    viewBox[2] !== viewBox[3]
  ) {
    throw new Error(`${label} must be authored on a square SVG canvas and viewBox`);
  }
  if (/<(?:text|image|script|foreignObject)\b/i.test(svg)) {
    throw new Error(`${label} layer may contain vector geometry only`);
  }
  if (!/<(?:path|rect|circle|ellipse|polygon|polyline|line)\b/i.test(svg)) {
    throw new Error(`${label} must contain visible vector geometry`);
  }
  for (const link of svg.matchAll(/\b(?:href|xlink:href)\s*=\s*["']([^"']+)["']/gi)) {
    if (!link[1].startsWith("#")) {
      throw new Error(`${label} may not reference external content`);
    }
  }
}

function readSvgAttribute(attributes, name) {
  return attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

function parseSvgDimension(value) {
  if (value === undefined || !/^[0-9]+(?:\.[0-9]+)?(?:px)?$/i.test(value)) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function validateAppleComposerRendition(png) {
  validatePng(png, 1024, 1024, "icons/app-macos-1024.png");
  validateReviewedApplePixels(decodePng(png, 1024), "macOS application icon");
}

function validateAppleDockSafeArea(decoded, label) {
  const alphaThreshold = 8;
  let minX = decoded.width;
  let minY = decoded.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      if (decoded.pixels[(y * decoded.width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0 || maxY < 0) throw new Error(`${label} has no visible pixels`);

  // A raw Icon Composer export reaches all four canvas edges. Apple's compiled
  // Dock representation reserves roughly ten percent per edge; require a
  // conservative six percent so future Xcode renderers may vary without ever
  // regressing to the visually oversized, full-bleed development icon.
  const minimumInset = Math.ceil(Math.min(decoded.width, decoded.height) * 0.06);
  const insets = [minX, minY, decoded.width - 1 - maxX, decoded.height - 1 - maxY];
  if (insets.some((inset) => inset < minimumInset)) {
    throw new Error(
      `${label} breaches the Dock safe area: visible bounds ${minX},${minY}..${maxX},${maxY}`,
    );
  }
}

function validateReviewedApplePixels(decoded, label) {
  const cornerOffsets = [
    0,
    (decoded.width - 1) * 4,
    (decoded.height - 1) * decoded.width * 4,
    (decoded.width * decoded.height - 1) * 4,
  ];
  if (cornerOffsets.some((offset) => decoded.pixels[offset + 3] !== 0)) {
    throw new Error(`${label} must have transparent rounded corners`);
  }

  let transparent = 0;
  let dark = 0;
  let light = 0;
  let visible = 0;
  let neutralMidtone = 0;
  let redAccent = 0;
  let greenAccent = 0;
  let blueAccent = 0;
  for (let offset = 0; offset < decoded.pixels.length; offset += 4) {
    const alpha = decoded.pixels[offset + 3];
    if (alpha === 0) {
      transparent += 1;
      continue;
    }
    visible += 1;
    const chroma =
      Math.max(decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]) -
      Math.min(decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]);
    const red = decoded.pixels[offset];
    const green = decoded.pixels[offset + 1];
    const blue = decoded.pixels[offset + 2];
    if (red > green + 12 && red > blue + 12) redAccent += 1;
    if (green > red + 12 && green > blue + 12) greenAccent += 1;
    if (blue > red + 12 && blue > green + 12) blueAccent += 1;
    const luminance = (red + green + blue) / 3;
    if (luminance < 100) dark += 1;
    if (luminance > 225) light += 1;
    if (chroma <= 8 && luminance > 140 && luminance < 235) neutralMidtone += 1;
  }
  const pixels = decoded.width * decoded.height;
  if (transparent < pixels * 0.01) {
    throw new Error(`${label} lost its rounded transparent silhouette`);
  }
  if (dark === 0 || light === 0) {
    throw new Error(`${label} lost either its mark or material field`);
  }
  if (neutralMidtone < visible * 0.01) {
    throw new Error(`${label} lost its neutral dot-field detail`);
  }
  if ([redAccent, greenAccent, blueAccent].some((count) => count < visible * 0.0005)) {
    throw new Error(`${label} lost one or more reviewed RGB mark accents`);
  }
}

function extractSinglePath(svg) {
  const paths = extractPaths(svg);
  if (paths.length !== 1 || paths[0].length === 0) {
    throw new Error(`tray master must contain exactly one non-empty path; found ${paths.length}`);
  }
  return paths[0];
}

function extractPaths(svg) {
  return [...svg.matchAll(/<path\s+d="([^"]+)"[^>]*\/>/g)].map((match) => match[1]);
}

function assertApplicationPixels(image, size) {
  let dark = 0;
  let light = 0;
  forEachVisiblePixel(image, ({ red, green, blue }) => {
    const luminance = (red + green + blue) / 3;
    // At 16px the reviewed horizontal mark is subpixel-antialiased rather than
    // carrying a fully opaque #212121 center pixel. It must still retain clear
    // contrast against the white field.
    if (luminance < 192) dark += 1;
    if (luminance > 240) light += 1;
  });
  if (dark === 0 || light === 0) {
    throw new Error(`application icon ${size}px lost either its mark or background`);
  }
}

function assertTemplatePixels(image, label) {
  let visible = 0;
  let translucent = 0;
  forEachVisiblePixel(image, ({ red, green, blue, alpha }) => {
    visible += 1;
    if (alpha < 255) translucent += 1;
    if (red !== 0 || green !== 0 || blue !== 0) {
      throw new Error(`macOS template ${label} contains non-black RGB at a visible pixel`);
    }
  });
  if (visible === 0 || translucent === 0) {
    throw new Error(`macOS template ${label} must be non-empty and retain antialiased alpha`);
  }
}

function assertDualTonePixels(image, label) {
  let dark = 0;
  let light = 0;
  forEachVisiblePixel(image, ({ red, green, blue }) => {
    const luminance = (red + green + blue) / 3;
    if (luminance < 80) dark += 1;
    // At the 16px Windows frame the one-pixel keyline is necessarily
    // antialiased into the panel edge; retain a materially lighter pixel rather
    // than demanding an impossible fully white center sample.
    if (luminance > 180) light += 1;
  });
  if (dark === 0 || light === 0) {
    throw new Error(`${label} tray image must retain both its dark mark and light keyline`);
  }
}

function forEachVisiblePixel(image, visitor) {
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const alpha = image.pixels[offset + 3];
    if (alpha === 0) continue;
    visitor({
      red: image.pixels[offset],
      green: image.pixels[offset + 1],
      blue: image.pixels[offset + 2],
      alpha,
    });
  }
}

async function validateGeneratedTree({ outputs, sourceFiles }) {
  const problems = [];
  for (const [path, expected] of outputs) {
    try {
      const actual = await readFile(path);
      if (!actual.equals(expected)) {
        problems.push(
          `${display(path)} is stale (actual ${digest(actual).slice(0, 12)}, expected ${digest(expected).slice(0, 12)})`,
        );
      }
    } catch (error) {
      problems.push(
        error?.code === "ENOENT" ? `${display(path)} is missing` : `${display(path)}: ${error}`,
      );
    }
  }

  const expectedTrayFiles = new Set(
    [...outputs.keys()]
      .filter((path) => dirname(path) === trayRoot)
      .map((path) => toPosix(relative(trayRoot, path))),
  );
  const actualTrayFiles = await listFiles(trayRoot);
  for (const file of actualTrayFiles) {
    if (!expectedTrayFiles.has(file)) problems.push(`tray/${file} is an unexpected staged asset`);
  }

  // Both sides of this comparison are posix-shaped (see toPosix): the absolute
  // keys come from join(), so the containment test must use the platform `sep`,
  // but every RELATIVE key — here, listFiles, and STATIC_SOURCE_FILES — speaks
  // forward slashes. Matching `${iconRoot}/` against a join()ed key selected
  // nothing on Windows, so the expected set came out empty and every committed
  // icon was reported an unexpected asset.
  const expectedIconFiles = new Set(
    [...outputs.keys()]
      .filter((path) => path.startsWith(`${iconRoot}${sep}`))
      .map((path) => toPosix(relative(iconRoot, path))),
  );
  const actualIconFiles = await listFiles(iconRoot);
  for (const file of actualIconFiles) {
    if (!expectedIconFiles.has(file) && !sourceFiles.has(file)) {
      problems.push(`icons/${file} is an unexpected generated/source asset`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `icon asset validation failed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\nRun: pnpm --filter @vibefield/desktop icons:generate`,
    );
  }
}

/** Relative asset keys are compared against literals written with forward
 * slashes (STATIC_SOURCE_FILES, icon.json layer names), so they are normalised
 * to posix regardless of the host separator. */
function toPosix(path) {
  return sep === "/" ? path : path.split(sep).join("/");
}

async function listFiles(root) {
  const files = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      for (const child of await listFiles(join(root, entry.name))) {
        files.push(`${entry.name}/${child}`);
      }
    } else if (entry.isFile()) {
      files.push(entry.name);
    } else {
      files.push(entry.name);
    }
  }
  return files;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function display(path) {
  return relative(packagingRoot, path).split("\\").join("/");
}
