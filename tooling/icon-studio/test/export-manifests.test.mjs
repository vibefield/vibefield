import assert from "node:assert/strict";
import { before, test } from "node:test";
import { buildBundle, bundleZip } from "../src/exports.mjs";
import { encodePng } from "../src/formats.mjs";
import { LIVING } from "../src/living-assets.mjs";
import { defaultRecipe, PLATFORMS } from "../src/model.mjs";

// The renderer is a recording fake; binary containers still receive real, correctly sized
// PNGs. These tests hold packaging contracts rather than reproducing the drawing algorithm.
const calls = [];
const cache = new Map();
const renderer = {
  async png(recipe, size, options) {
    calls.push({ type: "png", recipe, size, options });
    const key = `${size}:${Boolean(options.opaque)}`;
    if (!cache.has(key))
      cache.set(
        key,
        encodePng({
          width: size,
          height: size,
          rgba: new Uint8Array(size * size * 4).fill(255),
          opaque: Boolean(options.opaque),
        }),
      );
    return cache.get(key);
  },
  svg(recipe, options) {
    calls.push({ type: "svg", recipe, options });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="0 0 ${options.size} ${options.size}"><path d="M1 1h2v2H1z"/></svg>`;
  },
};
let files;
let map;
let recipe;
const parse = (path) => JSON.parse(map.get(path));

before(async () => {
  recipe = defaultRecipe();
  recipe.name = "VibeField / Studio";
  files = await buildBundle(recipe, renderer);
  map = new Map(files.map((file) => [file.name, file.data]));
});

test("all selected targets are represented with safe unique paths and a source recipe", () => {
  assert.equal(map.size, files.length);
  for (const path of map.keys())
    assert.ok(!path.startsWith("/") && !path.includes("..") && !path.includes("\\"), path);
  assert.deepEqual(parse("recipe.json"), recipe);
  const manifest = parse("export-manifest.json");
  assert.deepEqual(
    manifest.targets,
    PLATFORMS.map((p) => p.id),
  );
  assert.equal(manifest.files.length, files.length - 1);
  assert.ok(manifest.files.every((entry) => map.has(entry.path) && entry.bytes > 0));
  assert.ok(manifest.files.every((entry) => entry.path !== "export-manifest.json"));
  const zip = bundleZip(files);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
});

test("macOS preserves ten optical representations per appearance and editable source specializations", () => {
  for (const ground of ["light", "dark"]) {
    const prefix = `macos/vibefield-studio-${ground}.iconset/`;
    assert.equal(files.filter((file) => file.name.startsWith(prefix)).length, 10);
    const data = map.get(`macos/vibefield-studio-${ground}.icns`);
    assert.equal(new TextDecoder().decode(data.subarray(0, 4)), "icns");
    assert.equal(new DataView(data.buffer, data.byteOffset).getUint32(4), data.length);
  }
  assert.ok(
    calls.some((call) => call.type === "png" && call.size === 32 && call.options.pointSize === 16),
  );
  assert.ok(
    calls.some((call) => call.type === "png" && call.size === 32 && call.options.pointSize === 32),
  );
  const composer = parse("macos/vibefield-studio.icon/icon.json");
  assert.equal(composer["supported-platforms"].squares, "shared");
  assert.equal(composer.groups[0].layers.length, 1);
  const mark = composer.groups[0].layers[0];
  for (const { value } of mark["image-name-specializations"])
    assert.ok(map.has(`macos/vibefield-studio.icon/Assets/${value}`));
  assert.equal(mark.glass, false);
  assert.equal(composer.groups[0].translucency.enabled, false);
});

test("iOS asset metadata references three RGB square appearances", () => {
  const root = "ios/Assets.xcassets/AppIcon.appiconset";
  const images = parse(`${root}/Contents.json`).images;
  assert.equal(images.length, 3);
  assert.deepEqual(
    images.map((image) => image.appearances?.[0].value ?? "light"),
    ["light", "dark", "tinted"],
  );
  for (const image of images) {
    assert.equal(image.size, "1024x1024");
    assert.equal(image.platform, "ios");
    assert.equal(image.idiom, "universal");
    assert.equal(
      map.get(`${root}/${image.filename}`)[25],
      2,
      "PNG must not contain an alpha channel",
    );
  }
});

test("visionOS exports the Xcode stack schema, front-first and separate from its background", () => {
  const stack = "visionos/Assets.xcassets/AppIcon.solidimagestack";
  assert.deepEqual(parse(`${stack}/Contents.json`).layers, [
    { filename: "Front.solidimagestacklayer" },
    { filename: "Back.solidimagestacklayer" },
  ]);
  for (const part of ["Front", "Back"]) {
    const layer = `${stack}/${part}.solidimagestacklayer`;
    assert.deepEqual(parse(`${layer}/Contents.json`), { info: { author: "xcode", version: 1 } });
    assert.deepEqual(parse(`${layer}/Content.imageset/Contents.json`).images, [
      { filename: `${part}.png`, idiom: "vision", scale: "2x" },
    ]);
    assert.equal(map.get(`${layer}/Content.imageset/${part}.png`)[25], part === "Back" ? 2 : 6);
  }
  assert.ok(
    calls.some(
      (call) =>
        call.type === "png" &&
        call.size === 1024 &&
        call.options.layer === "mark" &&
        call.options.maskable === true,
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.type === "png" &&
        call.size === 1024 &&
        call.options.layer === "background" &&
        call.options.opaque === true,
    ),
  );
});

test("tray templates and conventional tray variants have distinct rendering contracts", () => {
  for (const suffix of ["", "Update", "Attention", "Offline"])
    for (const points of [16, 18, 22]) {
      for (const scale of ["", "@2x"])
        assert.ok(map.has(`tray/macos/${points}pt/vibefield-studio${suffix}Template${scale}.png`));
    }
  assert.ok(
    calls.some(
      (call) =>
        call.type === "png" &&
        call.options.purpose === "tray" &&
        call.options.appearance === "light" &&
        call.options.pointSize === 18 &&
        !call.options.keyline,
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.type === "png" &&
        call.options.purpose === "tray" &&
        call.options.appearance === "dark" &&
        call.options.keyline,
    ),
  );
  for (const ground of ["light", "dark"])
    for (const state of ["ready", "update", "attention", "offline"]) {
      assert.ok(map.has(`tray/windows/${ground}/vibefield-studio-${state}.ico`));
      assert.ok(map.has(`tray/linux/${ground}/vibefield-studio-${state}-22.png`));
    }
});

test("website keeps any and maskable images separate and each manifest path exists", () => {
  const manifest = parse("web/site.webmanifest");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.icons.length, 4);
  for (const icon of manifest.icons) {
    const png = map.get(`web/${icon.src}`);
    assert.ok(png);
    assert.equal(png[25], icon.purpose === "maskable" ? 2 : 6);
  }
  assert.equal(map.get("web/apple-touch-icon.png")[25], 2);
  assert.ok(
    calls.some(
      (call) =>
        call.type === "svg" && call.options.purpose === "favicon" && call.options.adaptive === true,
    ),
  );
  assert.ok(map.get("web/safari-pinned-tab.svg").includes('viewBox="0 0 16 16"'));
  assert.ok(map.get("web/head.html").includes('href="/site.webmanifest"'));
});

test("logo folder labels shipping animated assets separately from edited masters", () => {
  for (const ground of ["light", "dark"]) {
    assert.equal(map.get(`logo/original-living-mark-${ground}.svg`), LIVING[ground]);
    assert.ok(map.has(`logo/vibefield-studio-mark-${ground}.svg`));
  }
});

test("dust export keeps the field separate in Composer and labels raster-backed Linux SVG", async () => {
  const dust = { ...defaultRecipe(), style: "dust", targets: ["macos", "linux"] };
  const entries = await buildBundle(dust, renderer);
  const out = new Map(entries.map((file) => [file.name, file.data]));
  const composer = JSON.parse(out.get("macos/vibefield.icon/icon.json"));
  assert.equal(composer.groups[0].layers.length, 2);
  assert.equal(
    composer.groups[0].layers[0]["image-name-specializations"][0].value,
    "mark-light.svg",
    "Icon Composer places the first layer in front",
  );
  assert.equal(
    composer.groups[0].layers[1]["image-name-specializations"][0].value,
    "field-light.png",
    "the opaque dust field must stay behind the mark",
  );
  for (const layer of composer.groups[0].layers)
    for (const { value } of layer["image-name-specializations"]) {
      assert.ok(out.has(`macos/vibefield.icon/Assets/${value}`));
    }
  const svg = out.get("linux/hicolor/scalable/apps/vibefield.svg");
  assert.ok(svg.includes("data:image/png;base64,"));
  assert.ok(svg.includes("Raster-backed SVG"));
  const manifest = JSON.parse(out.get("export-manifest.json"));
  assert.equal(manifest.files.find((file) => file.path.endsWith("/vibefield.svg")).vector, false);
});

test("target filtering, progress, cancellation and invalid selections are explicit", async () => {
  const progress = [];
  const entries = await buildBundle(defaultRecipe(), renderer, {
    targets: ["ios", "ios"],
    onProgress: (event) => progress.push(event),
  });
  assert.ok(
    entries.every(
      (file) =>
        file.name.startsWith("ios/") ||
        ["README.md", "recipe.json", "export-manifest.json"].includes(file.name),
    ),
  );
  assert.equal(progress.at(-1).done, 1);
  assert.equal(progress.at(-1).total, 1);
  await assert.rejects(
    buildBundle(defaultRecipe(), renderer, { targets: [] }),
    /Select at least one/,
  );
  await assert.rejects(
    buildBundle(defaultRecipe(), renderer, { targets: ["other"] }),
    /Unknown export target/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildBundle(defaultRecipe(), renderer, { signal: controller.signal }), {
    name: "AbortError",
  });
  const during = new AbortController();
  await assert.rejects(
    buildBundle(defaultRecipe(), renderer, {
      targets: ["ios"],
      signal: during.signal,
      onProgress: () => during.abort(),
    }),
    { name: "AbortError" },
  );
});
