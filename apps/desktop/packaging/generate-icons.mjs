#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const execFileAsync = promisify(execFile);
const packagingRoot = dirname(fileURLToPath(import.meta.url));
const iconRoot = join(packagingRoot, "icons");
const trayRoot = join(packagingRoot, "tray");
// The phone's icon is drawn from the same Icon Composer layers as the desktop's, so the two
// never carry different marks (until 2026-10-09 it was a hand-made copy of the desktop master).
const iosIconRoot = resolve(
  packagingRoot,
  "..",
  "..",
  "ios",
  "App",
  "Assets.xcassets",
  "AppIcon.appiconset",
);
const builderConfigPath = join(packagingRoot, "electron-builder.yml");
const trayMasterPath = join(iconRoot, "tray-master.svg");
const appleIconPath = join(iconRoot, "app.icon");
const appleComposerRenditionPath = join(iconRoot, "app-macos-1024.png");
const appleComposerDarkRenditionPath = join(iconRoot, "app-macos-dark-1024.png");
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
// Drawn straight from the vector, the mark's band thins under a pixel at the small platform
// sizes (the twist's hairline first), so they draw it heavier: one output pixel (half a pixel
// each side, the optical weight the previous master's small sizes carried) at FULL and under,
// easing by log size to none at NONE, so neighbouring sizes never jump in weight.
const OPTICAL_WEIGHT_FULL_SIZE = 32;
const OPTICAL_WEIGHT_NONE_SIZE = 128;
// The mark layers are the lab's vectors on a 1024 canvas (see README.md).
const MARK_CANVAS = 1024;
// The conventional platforms' tile: the lab's icon mask, a superellipse (n = 5) at full bleed.
const TILE_EXPONENT = 5;
const IOS_ICON_SIZE = 1024;
const IOS_ICONS = [
  { file: "AppIcon.png", appearance: null, ground: "#FFFFFF", mark: "light", grayscale: false },
  {
    file: "AppIcon-Dark.png",
    appearance: "dark",
    ground: "#000000",
    mark: "dark",
    grayscale: false,
  },
  // Tinted: the system tints a grayscale icon, so it gets the dark art with its lights in grey.
  {
    file: "AppIcon-Tinted.png",
    appearance: "tinted",
    ground: "#000000",
    mark: "dark",
    grayscale: true,
  },
];
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
  // AU-4 (AU-D12, AU-G14): an install waits on the person — the mark with one plain dot, no bang
  {
    kind: "update",
    mac1x: "fieldUpdateTemplate.png",
    mac2x: "fieldUpdateTemplate@2x.png",
    windows: "field-update.ico",
    linux: "field-linux-update.png",
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
const STATIC_SOURCE_FILES = new Set(["README.md", "app.icon/icon.json", "tray-master.svg"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TILE_PATH = superellipsePath(MARK_CANVAS / 2, TILE_EXPONENT, 720);
// The band of a mark layer: its far and near halves, each filled and outlined in the ink (the
// outline is what leaves the twist's hairline); the lights are stroked paths without a fill.
const BAND_PATTERN =
  /<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})" stroke="\2" stroke-width="([0-9.]+)"/g;

const args = new Set(process.argv.slice(2));
const checkOnly = args.delete("--check");
if (args.size > 0) {
  throw new Error(`unknown icon generator option(s): ${[...args].join(", ")}`);
}

const [trayMaster, builderConfig, appleIconDefinition, iosIconContents] = await Promise.all([
  readFile(trayMasterPath, "utf8"),
  readFile(builderConfigPath, "utf8"),
  readFile(join(appleIconPath, "icon.json"), "utf8"),
  readFile(join(iosIconRoot, "Contents.json"), "utf8"),
]);
assertSquareMaster(trayMaster, "tray");
assertBuilderIconConfig(builderConfig);
const appleIconSource = await validateAppleIconSource(appleIconDefinition);
validateIosIconContents(iosIconContents);
const trayPath = extractSinglePath(trayMaster);
const appleAssets = await compileAppleIconAssets();
const generated = generateAssets({ marks: appleIconSource.marks, trayPath, ...appleAssets });

if (!checkOnly) {
  for (const [path, asset] of generated.outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, asset);
  }
}

await validateGeneratedTree({
  outputs: generated.outputs,
  pixelOutputs: generated.pixelOutputs,
  sourceFiles: new Set([...STATIC_SOURCE_FILES, ...appleIconSource.sourceFiles]),
});
console.log(
  `icons ${checkOnly ? "current" : "generated"}: ${generated.outputs.size} files, app ${APP_RENDER_SIZES.length} conventional raster sizes, macOS light + dark renditions and the official ICNS fallback, iOS light/dark/tinted, tray ${TRAY_STATES.length} states`,
);

function generateAssets({
  marks,
  trayPath,
  appleComposerRendition,
  appleComposerDarkRendition,
  appleFallbackIcns,
}) {
  const outputs = new Map();
  // iOS icons are compared by their decoded pixels, not their bytes (see encodeRgbPng).
  const pixelOutputs = new Map();
  const pngs = new Map();
  const appImages = new Map();
  const { developmentDockIcon } = validateAppleFallbackIcns(appleFallbackIcns);

  for (const size of APP_RENDER_SIZES) {
    const image = render(conventionalSvg(marks.light, size), size);
    assertApplicationPixels(image, size);
    appImages.set(size, image);
  }

  addPng("icons/app-1024.png", appImages.get(1024));
  add("icons/app-macos-1024.png", appleComposerRendition);
  add("icons/app-macos-dark-1024.png", appleComposerDarkRendition);
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

  for (const icon of IOS_ICONS) {
    const image = render(iosSvg(marks[icon.mark], icon.ground, icon.grayscale), IOS_ICON_SIZE);
    assertIosPixels(image, icon);
    const path = join(iosIconRoot, icon.file);
    if (outputs.has(path)) throw new Error(`duplicate generated asset: ${icon.file}`);
    outputs.set(path, encodeRgbPng(image, `iOS ${icon.file}`));
    pixelOutputs.set(path, rgbPixels(image));
  }

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

  return { outputs, pixelOutputs, pngs };

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
      const [appleComposerRendition, appleComposerDarkRendition, appleFallbackIcns] =
        await Promise.all([
          readFile(appleComposerRenditionPath),
          readFile(appleComposerDarkRenditionPath),
          readFile(appleFallbackIconPath),
        ]);
      committed = { appleComposerRendition, appleComposerDarkRendition, appleFallbackIcns };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          "a committed macOS rendition or the ICNS fallback is missing and can only be generated with Xcode 26 on macOS",
        );
      }
      throw error;
    }
    validateAppleComposerRendition(committed.appleComposerRendition, "light");
    validateAppleComposerRendition(committed.appleComposerDarkRendition, "dark");
    validateAppleFallbackIcns(committed.appleFallbackIcns);
    console.warn(
      checkOnly
        ? "check mode validates the committed macOS PNGs and ICNS as-is; re-rendering them is icons:generate's act"
        : "Xcode Icon Composer and actool are unavailable; validated the committed macOS PNGs and ICNS without regenerating them",
    );
    return committed;
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "vibefield-icon-composer-"));
  const renditionPath = (rendition) => join(temporaryRoot, `app-macos-${rendition}-1024.png`);
  const compiledOutputRoot = join(temporaryRoot, "compiled");
  const partialInfoPath = join(temporaryRoot, "partial-info.plist");
  try {
    await mkdir(compiledOutputRoot);
    const options = {
      env: { ...process.env, DEVELOPER_DIR: toolchain.developerDir },
      maxBuffer: 4 * 1024 * 1024,
    };
    // The full-canvas composition in both appearances the icon defines: Default (the white
    // ground, black mark) and Dark (the black ground, white mark).
    const exportRendition = (rendition) =>
      execFileAsync(
        toolchain.iconComposer,
        [
          appleIconPath,
          "--export-image",
          "--output-file",
          renditionPath(rendition),
          "--platform",
          "macOS",
          "--rendition",
          rendition,
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
      );
    await Promise.all([
      exportRendition("Default"),
      exportRendition("Dark"),
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
    const [appleComposerRendition, appleComposerDarkRendition, appleFallbackIcns] =
      await Promise.all([
        readFile(renditionPath("Default")),
        readFile(renditionPath("Dark")),
        readFile(join(compiledOutputRoot, "app.icns")),
      ]);
    validateAppleComposerRendition(appleComposerRendition, "light");
    validateAppleComposerRendition(appleComposerDarkRendition, "dark");
    validateAppleFallbackIcns(appleFallbackIcns);
    return { appleComposerRendition, appleComposerDarkRendition, appleFallbackIcns };
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

/** Windows and Linux take the default (light) appearance on the lab's tile. */
function conventionalSvg(mark, size) {
  const ease =
    Math.log2(OPTICAL_WEIGHT_NONE_SIZE / size) /
    Math.log2(OPTICAL_WEIGHT_NONE_SIZE / OPTICAL_WEIGHT_FULL_SIZE);
  const weight = (Math.min(1, Math.max(0, ease)) * MARK_CANVAS) / size;
  return `<svg width="${MARK_CANVAS}" height="${MARK_CANVAS}" viewBox="0 0 ${MARK_CANVAS} ${MARK_CANVAS}" xmlns="http://www.w3.org/2000/svg"><path d="${TILE_PATH}" fill="#FFFFFF"/>${markContent(mark, weight)}</svg>`;
}

/** iOS takes a full-bleed opaque square (the system masks it), one per appearance. */
function iosSvg(mark, ground, grayscale) {
  const open = grayscale
    ? '<defs><filter id="grey" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs><g filter="url(#grey)">'
    : "<g>";
  return `<svg width="${MARK_CANVAS}" height="${MARK_CANVAS}" viewBox="0 0 ${MARK_CANVAS} ${MARK_CANVAS}" xmlns="http://www.w3.org/2000/svg">${open}<rect width="${MARK_CANVAS}" height="${MARK_CANVAS}" fill="${ground}"/>${markContent(mark, 0)}</g></svg>`;
}

/** A mark layer's drawing without its root element; `weight` (canvas px) widens the band. */
function markContent(svg, weight) {
  const inner = svg.slice(svg.indexOf(">", svg.search(/<svg\b/i)) + 1, svg.lastIndexOf("</svg>"));
  if (weight <= 0) return inner;
  return inner.replace(BAND_PATTERN, (_, d, ink, width) => {
    const widened = (Number(width) + weight).toFixed(2);
    return `<path d="${d}" fill="${ink}" stroke="${ink}" stroke-width="${widened}"`;
  });
}

function superellipsePath(radius, exponent, steps) {
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (2 * Math.PI * index) / steps;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = radius + radius * Math.sign(c) * Math.abs(c) ** (2 / exponent);
    const y = radius + radius * Math.sign(s) * Math.abs(s) ** (2 / exponent);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

function traySvg(path, state, style) {
  const template = style === "template";
  const base = template
    ? `<path d="${path}" fill="#000000" stroke="#000000" stroke-width="24" stroke-linejoin="round"/>`
    : `<path d="${path}" fill="#ffffff" stroke="#ffffff" stroke-width="64" stroke-linejoin="round"/><path d="${path}" fill="#202124" stroke="#202124" stroke-width="24" stroke-linejoin="round"/>`;
  // The attention and offline badges are a disk merged into the band, their glyph cut out of it. The update's is a
  // plain dot (AU-4, AU-D12): merged, it would read as a bump on the mark, so it stands apart instead — a ring is cut
  // from the mark alone around the badge's centre, and the dot is drawn whole inside it, after the mask.
  const badge =
    state === "base" || state === "update"
      ? ""
      : template
        ? '<circle cx="374" cy="318" r="66" fill="#000000" stroke="#000000" stroke-width="24"/>'
        : '<circle cx="374" cy="318" r="66" fill="#ffffff" stroke="#ffffff" stroke-width="64"/><circle cx="374" cy="318" r="66" fill="#202124" stroke="#202124" stroke-width="24"/>';
  const cutout =
    state === "attention"
      ? '<rect x="365" y="275" width="18" height="51" rx="9" fill="black"/><circle cx="374" cy="346" r="11" fill="black"/>'
      : state === "offline"
        ? '<rect x="341" y="309" width="66" height="18" rx="9" fill="black"/>'
        : state === "update"
          ? '<circle cx="374" cy="318" r="96" fill="black"/>'
          : "";
  const dot =
    state !== "update"
      ? ""
      : template
        ? '<circle cx="374" cy="318" r="58" fill="#000000"/>'
        : '<circle cx="374" cy="318" r="78" fill="#ffffff"/><circle cx="374" cy="318" r="58" fill="#202124"/>';
  const mask =
    state === "base"
      ? ""
      : `<mask id="status-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="480"><rect width="480" height="480" fill="white"/>${cutout}</mask>`;
  const maskAttribute = state === "base" ? "" : ' mask="url(#status-cutout)"';
  return `<svg width="480" height="480" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg"><defs>${mask}</defs><g${maskAttribute}>${base}${badge}</g>${dot}</svg>`;
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

/** App Store icons may carry no alpha channel (ITMS-90717), and resvg writes RGBA, so iOS icons
 * are re-encoded here as 8-bit RGB. zlib's compressed bytes are not promised across Node
 * releases, so these files are checked by their decoded pixels (readRgbPng), never their bytes. */
function encodeRgbPng(image, label) {
  const rgb = rgbPixels(image, label);
  const stride = image.width * 3;
  const scanlines = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    scanlines[y * (stride + 1)] = 0;
    rgb.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function rgbPixels(image, label = "iOS icon") {
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let index = 0; index < image.width * image.height; index += 1) {
    if (image.pixels[index * 4 + 3] !== 255) {
      throw new Error(
        `${label} must be opaque; pixel ${index} has alpha ${image.pixels[index * 4 + 3]}`,
      );
    }
    image.pixels.copy(rgb, index * 3, index * 4, index * 4 + 3);
  }
  return rgb;
}

/** The pixels of an 8-bit RGB PNG (any row filter), for comparing what encodeRgbPng wrote. */
function readRgbPng(buffer, label) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a PNG`);
  }
  let header = null;
  const data = [];
  for (let offset = 8; offset + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = body;
    if (type === "IDAT") data.push(body);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (header === null || header.readUInt8(8) !== 8 || header.readUInt8(9) !== 2) {
    throw new Error(`${label} must be an 8-bit RGB PNG without an alpha channel`);
  }
  if (header.readUInt8(12) !== 0) throw new Error(`${label} must not be interlaced`);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const stride = width * 3;
  const raw = inflateSync(Buffer.concat(data));
  const rgb = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? rgb[y * stride + x - 3] : 0;
      const up = y > 0 ? rgb[(y - 1) * stride + x] : 0;
      const corner = x >= 3 && y > 0 ? rgb[(y - 1) * stride + x - 3] : 0;
      let value = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toCorner = Math.abs(estimate - corner);
        value += toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner;
      } else if (filter !== 0) throw new Error(`${label} row ${y} has unknown filter ${filter}`);
      rgb[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, rgb };
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
        // the fallback is the default appearance: ICNS has no dark representation
        validateReviewedApplePixels(decoded, `${label} ${expected[1]}px`, "light");
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
  // The reviewed grounds (2026-10-09, James's plain icons: "pure white and pure black
  // background with no patterns"): a solid white fill by default, a solid black one in dark.
  const fills = Array.isArray(parsed["fill-specializations"]) ? parsed["fill-specializations"] : [];
  const groundOf = (appearance) =>
    fills.find((entry) => (entry?.appearance ?? null) === appearance)?.value;
  assertSolidGround(groundOf(null), 1, "default");
  assertSolidGround(groundOf("dark"), 0, "dark");

  const referencedAssets = new Set();
  let markImages = null;
  for (const [groupIndex, group] of parsed.groups.entries()) {
    if (!Array.isArray(group?.layers) || group.layers.length === 0) {
      throw new Error(`icons/app.icon group ${groupIndex + 1} must contain at least one layer`);
    }
    for (const [layerIndex, layer] of group.layers.entries()) {
      const label = `icons/app.icon group ${groupIndex + 1} layer ${layerIndex + 1}`;
      const images = layerImages(layer, label);
      for (const imageName of images.values()) {
        if (
          typeof imageName !== "string" ||
          imageName.length === 0 ||
          basename(imageName) !== imageName ||
          extname(imageName).toLowerCase() !== ".svg"
        ) {
          throw new Error(`${label} must reference a local SVG asset by filename`);
        }
        referencedAssets.add(imageName);
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
      if (images.has("dark")) {
        if (markImages !== null) {
          throw new Error("icons/app.icon must give exactly one layer, the mark, a dark image");
        }
        markImages = images;
      }
    }
  }
  if (markImages === null || !markImages.has(null)) {
    throw new Error(
      "icons/app.icon's mark layer must name its default and dark images in image-name-specializations",
    );
  }

  const assetsRoot = join(appleIconPath, "Assets");
  const expectedAssets = [...referencedAssets].sort();
  const actualAssets = (await listFiles(assetsRoot)).sort();
  if (actualAssets.join("\n") !== expectedAssets.join("\n")) {
    throw new Error(
      `icons/app.icon Assets must exactly match the referenced SVG layers; expected ${expectedAssets.join(", ")}, found ${actualAssets.join(", ")}`,
    );
  }

  const svgs = new Map(
    await Promise.all(
      expectedAssets.map(async (asset) => {
        const svg = await readFile(join(assetsRoot, asset), "utf8");
        assertLayerSvg(svg, `Apple layer ${asset}`);
        return [asset, svg];
      }),
    ),
  );
  const marks = {
    light: svgs.get(markImages.get(null)),
    dark: svgs.get(markImages.get("dark")),
  };
  assertMarkLayer(marks.light, "#000000", `Apple layer ${markImages.get(null)}`);
  assertMarkLayer(marks.dark, "#FFFFFF", `Apple layer ${markImages.get("dark")}`);
  return { sourceFiles: expectedAssets.map((asset) => `app.icon/Assets/${asset}`), marks };
}

/** A layer's image per appearance (null: the default). Icon Composer draws `image-name` over
 * its specializations — a dark image beside an `image-name` never shows (measured with ictool
 * 17F113, 2026-10-09) — so a layer names its images one way or the other, never both. */
function layerImages(layer, label) {
  const specializations = layer?.["image-name-specializations"];
  if (specializations === undefined) return new Map([[null, layer?.["image-name"]]]);
  if (layer["image-name"] !== undefined) {
    throw new Error(
      `${label} names image-name and image-name-specializations; Icon Composer then never draws the specialized images — move the default into the specializations`,
    );
  }
  if (!Array.isArray(specializations) || specializations.length === 0) {
    throw new Error(`${label} has empty image-name-specializations`);
  }
  const images = new Map();
  for (const entry of specializations) {
    const appearance = entry?.appearance ?? null;
    if (![null, "dark", "tinted"].includes(appearance) || images.has(appearance)) {
      throw new Error(`${label} has an unknown or repeated image appearance ${appearance}`);
    }
    images.set(appearance, entry?.value);
  }
  return images;
}

function assertSolidGround(fill, level, appearance) {
  const color = typeof fill?.solid === "string" ? fill.solid : "";
  const [space, values] = color.split(":");
  const channels = (values ?? "").split(",").map(Number);
  const ok =
    ["extended-gray", "srgb", "extended-srgb", "display-p3"].includes(space) &&
    channels.length === (space === "extended-gray" ? 2 : 4) &&
    channels.slice(0, -1).every((channel) => Math.abs(channel - level) < 1e-6) &&
    channels.at(-1) === 1;
  if (!ok) {
    throw new Error(
      `icons/app.icon's ${appearance} ground must be solid ${level === 1 ? "white" : "black"}; got ${JSON.stringify(fill ?? null)}`,
    );
  }
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

/** A mark layer is the lab's drawing on the 1024 canvas, with no ground of its own (the icon's
 * fill is the ground): its band in two halves in the appearance's ink, and its lights. */
function assertMarkLayer(svg, ink, label) {
  if (!new RegExp(`viewBox="0 0 ${MARK_CANVAS} ${MARK_CANVAS}"`).test(svg)) {
    throw new Error(`${label} must be drawn on the ${MARK_CANVAS}x${MARK_CANVAS} canvas`);
  }
  if (/<rect\b/i.test(svg)) {
    throw new Error(`${label} must carry no ground; the icon's fill is its ground`);
  }
  const bands = [...svg.matchAll(BAND_PATTERN)];
  if (bands.length !== 2 || bands.some((band) => band[2].toUpperCase() !== ink)) {
    const found = bands.map((band) => band[2].toUpperCase()).join(", ") || "none";
    throw new Error(`${label} must draw its band as two halves in ${ink}; found ${found}`);
  }
  // Each light blends toward the next along its length, so its strokes carry many colours;
  // between them they must still hold a rose, a green and a blue one.
  const families = new Set();
  for (const [, hex] of svg.matchAll(/<path d="[^"]+" stroke="#([0-9A-Fa-f]{6})"/g)) {
    const [red, green, blue] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    if (red > green + 64 && red > blue + 64) families.add("rose");
    if (green > red + 64 && green > blue + 64) families.add("green");
    if (blue > red + 64 && blue > green + 64) families.add("blue");
  }
  if (families.size !== 3) {
    throw new Error(`${label} must keep its three lights; found ${[...families].join(", ")}`);
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

function validateIosIconContents(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error("the iOS AppIcon Contents.json is not valid JSON", { cause: error });
  }
  const images = Array.isArray(parsed?.images) ? parsed.images : [];
  const problems = [];
  if (images.length !== IOS_ICONS.length) {
    problems.push(`${images.length} images; expected ${IOS_ICONS.length}`);
  }
  for (const icon of IOS_ICONS) {
    const image = images.find((entry) => entry?.filename === icon.file);
    const appearances = image?.appearances ?? [];
    const appearance =
      appearances.length === 0
        ? null
        : appearances.length === 1 && appearances[0]?.appearance === "luminosity"
          ? appearances[0].value
          : "?";
    if (
      image === undefined ||
      image.idiom !== "universal" ||
      image.platform !== "ios" ||
      image.size !== `${IOS_ICON_SIZE}x${IOS_ICON_SIZE}` ||
      appearance !== icon.appearance
    ) {
      problems.push(`${icon.file} must be the universal ${icon.appearance ?? "default"} 1024 icon`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `the iOS AppIcon Contents.json is not the generated set: ${problems.join("; ")}`,
    );
  }
}

function validateAppleComposerRendition(png, appearance) {
  const label =
    appearance === "light" ? "icons/app-macos-1024.png" : "icons/app-macos-dark-1024.png";
  validatePng(png, 1024, 1024, label);
  validateReviewedApplePixels(
    decodePng(png, 1024),
    `macOS ${appearance} application icon`,
    appearance,
  );
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

/** What the reviewed icon must keep in an appearance: its rounded transparent silhouette, the
 * plain ground (white, or black in dark), the mark in the other ink, and the three lights. */
function validateReviewedApplePixels(decoded, label, appearance) {
  const cornerOffsets = [
    0,
    (decoded.width - 1) * 4,
    (decoded.height - 1) * decoded.width * 4,
    (decoded.width * decoded.height - 1) * 4,
  ];
  if (cornerOffsets.some((offset) => decoded.pixels[offset + 3] !== 0)) {
    throw new Error(`${label} must have transparent rounded corners`);
  }
  const counts = countPixels(decoded);
  const pixels = decoded.width * decoded.height;
  if (counts.transparent < pixels * 0.01) {
    throw new Error(`${label} lost its rounded transparent silhouette`);
  }
  const dark = appearance === "dark";
  const ground = dark ? counts.black : counts.white;
  const ink = dark ? counts.light : counts.dark;
  if (ground < counts.visible * 0.5) {
    throw new Error(`${label} lost its plain ${dark ? "black" : "white"} ground`);
  }
  if (ink === 0) {
    throw new Error(`${label} lost its ${dark ? "white" : "black"} mark`);
  }
  if ([counts.red, counts.green, counts.blue].some((count) => count < counts.visible * 0.0005)) {
    throw new Error(`${label} lost one or more of the mark's three lights`);
  }
}

function countPixels(image) {
  const counts = {
    transparent: 0,
    visible: 0,
    white: 0,
    black: 0,
    light: 0,
    dark: 0,
    red: 0,
    green: 0,
    blue: 0,
    darkest: 255,
  };
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const alpha = image.pixels[offset + 3];
    if (alpha === 0) {
      counts.transparent += 1;
      continue;
    }
    counts.visible += 1;
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    const luminance = (red + green + blue) / 3;
    if (alpha === 255) counts.darkest = Math.min(counts.darkest, luminance);
    if (alpha === 255 && luminance >= 250) counts.white += 1;
    if (alpha === 255 && luminance <= 5) counts.black += 1;
    if (luminance > 200) counts.light += 1;
    if (luminance < 60) counts.dark += 1;
    if (red > green + 12 && red > blue + 12) counts.red += 1;
    if (green > red + 12 && green > blue + 12) counts.green += 1;
    if (blue > red + 12 && blue > green + 12) counts.blue += 1;
  }
  return counts;
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
  const label = `application icon ${size}px`;
  if ([0, size - 1].some((x) => [0, size - 1].some((y) => image.pixels[(y * size + x) * 4 + 3]))) {
    throw new Error(`${label} must keep the tile's transparent corners`);
  }
  const counts = countPixels(image);
  if (counts.white < counts.visible * 0.5) throw new Error(`${label} lost its white ground`);
  // At 16px the band is antialiased rather than carrying a fully black centre pixel; it must
  // still read clearly dark against the white ground.
  if (counts.darkest >= (size > 16 ? 60 : 160)) throw new Error(`${label} lost its black mark`);
  if ([counts.red, counts.green, counts.blue].some((count) => count === 0)) {
    throw new Error(`${label} lost one or more of the mark's three lights`);
  }
}

function assertIosPixels(image, icon) {
  const label = `iOS ${icon.file}`;
  const counts = countPixels(image);
  if (counts.visible !== image.width * image.height) throw new Error(`${label} must be opaque`);
  const corner = image.pixels.subarray(0, 3);
  const ground = icon.ground === "#FFFFFF" ? 255 : 0;
  if ([...corner].some((channel) => channel !== ground)) {
    throw new Error(`${label} must reach the canvas edge in its plain ground ${icon.ground}`);
  }
  const ink = ground === 255 ? counts.dark : counts.light;
  if (ink === 0) throw new Error(`${label} lost its mark`);
  const lights = [counts.red, counts.green, counts.blue];
  if (icon.grayscale) {
    for (let offset = 0; offset < image.pixels.length; offset += 4) {
      const [red, green, blue] = image.pixels.subarray(offset, offset + 3);
      if (red !== green || green !== blue) throw new Error(`${label} must be grayscale`);
    }
  } else if (lights.some((count) => count < counts.visible * 0.0005)) {
    throw new Error(`${label} lost one or more of the mark's three lights`);
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

async function validateGeneratedTree({ outputs, pixelOutputs, sourceFiles }) {
  const problems = [];
  for (const [path, expected] of outputs) {
    try {
      const actual = await readFile(path);
      const expectedPixels = pixelOutputs.get(path);
      if (expectedPixels !== undefined) {
        const decoded = readRgbPng(actual, display(path));
        if (
          decoded.width !== IOS_ICON_SIZE ||
          decoded.height !== IOS_ICON_SIZE ||
          !decoded.rgb.equals(expectedPixels)
        ) {
          problems.push(`${display(path)} is stale (its pixels differ)`);
        }
      } else if (!actual.equals(expected)) {
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

  const expectedIosFiles = new Set(["Contents.json", ...IOS_ICONS.map((icon) => icon.file)]);
  for (const file of await listFiles(iosIconRoot)) {
    if (!expectedIosFiles.has(file)) {
      problems.push(`${display(join(iosIconRoot, file))} is an unexpected iOS icon asset`);
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
