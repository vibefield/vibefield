import assert from "node:assert/strict";
import test from "node:test";
import {
  artParams,
  cloneRecipe,
  defaultRecipe,
  PLATFORMS,
  readRecipe,
  slug,
  starterRecipe,
} from "../src/model.mjs";
import { createRenderer } from "../src/render.mjs";
import { DEFAULTS, PARAMS, presetValues } from "../vendor/wormhole.mjs";

test("a saved Wormhole Dust look retains its tuned field, optical settings and ribbon geometry", () => {
  const original = {
    base: "warp",
    palette: "prism",
    name: "Warp with room for the mark",
    params: {
      ...presetValues("warp"),
      dustRows: 200,
      dustStreak: 9,
      dustOrbit: 2.5,
      smLook: false,
      smExposure: 0.27,
      smWeight: 2.1,
      livWidth: 1.2,
      livHeight: 0.5,
      livRestTwist: 24,
      livRestLights: 0.37,
      livColorA: "#B0235E",
      invert: true,
    },
  };
  const inputBefore = JSON.stringify(original);
  const { recipe, dropped } = readRecipe(original);
  assert.equal(JSON.stringify(original), inputBefore, "import does not mutate the supplied look");
  assert.equal(recipe.style, "dust");
  assert.equal(recipe.appearance, "light");
  assert.equal(recipe.name, original.name);
  assert.equal(recipe.palette, original.palette);
  assert.deepEqual(
    recipe.params,
    original.params,
    "an already valid look is not reset to a starting preset",
  );
  assert.deepEqual(dropped, []);
});

test("an exported recipe can be reimported without losing the appearance, targets or custom grounds", () => {
  const original = defaultRecipe();
  Object.assign(original, {
    name: "VibeField review 2",
    appearance: "tinted",
    time: 22.75,
    lightGround: "#F4EEE6",
    darkGround: "#17202C",
    trayWeight: 2,
    faviconWeight: 1.8,
    faviconStyle: "mark",
    iconAtRest: false,
    targets: ["web", "tray"],
  });
  Object.assign(original.params, { livPose: "slow lap", livRestLights: 0.28, dustStreak: 8 });
  const { recipe, dropped } = readRecipe(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(
    { ...recipe, targets: [...recipe.targets].sort() },
    { ...original, targets: [...original.targets].sort() },
  );
  assert.deepEqual(dropped, []);
});

test("raw parameter JSON and wrapped Wormhole look JSON describe the same artwork", () => {
  const params = { ...presetValues("deep"), dustFill: 0.23, livTilt: 12, livRestTwist: -30 };
  const raw = readRecipe(params).recipe;
  const wrapped = readRecipe({ base: "deep", params }).recipe;
  assert.deepEqual(raw.params, wrapped.params);
  assert.equal(raw.appearance, wrapped.appearance);
  assert.equal(raw.style, wrapped.style);
});

test("unknown knobs are reported, numeric limits are bounded, and invalid values cannot enter artwork", () => {
  const { recipe, dropped } = readRecipe({
    params: {
      dustRows: 1e9,
      dustStreak: -10,
      zoom: 2.25,
      livColorA: "abcdef",
      livScale: "not-a-number",
      ink: "url(https://example.invalid/image)",
      unknownKnob: 42,
    },
  });
  assert.equal(recipe.params.dustRows, PARAMS.dustRows.max);
  assert.equal(recipe.params.dustStreak, PARAMS.dustStreak.min);
  assert.equal(recipe.params.zoom, 2.25);
  assert.equal(recipe.params.livColorA, "#ABCDEF");
  assert.equal(recipe.params.livScale, DEFAULTS.livScale);
  assert.equal(recipe.params.ink, DEFAULTS.ink);
  assert.ok(dropped.includes("unknownKnob"));
  assert.ok(dropped.includes("livScale"), "invalid values are surfaced to the importer");
  assert.ok(dropped.includes("ink"));
  assert.equal(Object.hasOwn(recipe.params, "unknownKnob"), false);
});

test("malformed numbers and booleans do not silently change camera or appearance", () => {
  const { recipe, dropped } = readRecipe({
    params: { zoom: null, livScale: false, invert: "false", livPose: "at rest" },
  });
  assert.equal(recipe.params.zoom, DEFAULTS.zoom, "null is not a zoom of zero");
  assert.equal(recipe.params.livScale, DEFAULTS.livScale, "false is not a numeric scale");
  assert.equal(recipe.params.invert, false, "the text false must never invert the artwork");
  for (const key of ["zoom", "livScale", "invert"])
    assert.ok(dropped.includes(key), `${key} rejection is visible`);
  assert.equal(
    readRecipe({ params: { zoom: "2.25" } }).recipe.params.zoom,
    DEFAULTS.zoom,
    "numeric strings are rejected consistently",
  );
});

test("unsupported ribbon rendering styles are normalized with an explicit warning", () => {
  const { recipe, dropped } = readRecipe({
    params: {
      ...presetValues("wormhole"),
      mark: "calligraphy",
      livProfile: "tube",
      livShading: "lit",
      livEdge: "rgb",
    },
  });
  assert.equal(recipe.params.mark, "living");
  assert.equal(recipe.params.livProfile, "flat");
  assert.equal(recipe.params.livShading, "flat");
  assert.equal(recipe.params.livEdge, "line");
  for (const key of ["mark", "livProfile", "livShading", "livEdge"]) {
    assert.ok(
      dropped.some((warning) => warning.startsWith(key)),
      `${key} conversion is reported`,
    );
  }
});

test("empty documents, unsupported versions and inherited property names are not valid looks", () => {
  for (const input of [
    null,
    [],
    {},
    { params: {} },
    { params: [] },
    { unrelated: 1 },
    JSON.parse('{"constructor":{}}'),
    JSON.parse('{"params":{"__proto__":{}}}'),
    { ...defaultRecipe(), version: 2 },
  ]) {
    assert.throws(() => readRecipe(input), /parameters|recipe|version|look/i);
  }
});

test("target imports discard unknown platforms without introducing or duplicating exports", () => {
  const { recipe } = readRecipe({
    ...defaultRecipe(),
    targets: ["web", "web", "not-a-platform", "ios"],
  });
  assert.deepEqual(new Set(recipe.targets), new Set(["web", "ios"]));
  assert.equal(recipe.targets.length, 2);
  assert.ok(recipe.targets.every((id) => PLATFORMS.some((platform) => platform.id === id)));
});

test("starting another look preserves the project name and selected delivery targets", () => {
  const previous = defaultRecipe();
  previous.name = "VibeField RC";
  previous.targets = ["windows", "linux"];
  const next = starterRecipe("deep", previous);
  assert.equal(next.name, previous.name);
  assert.deepEqual(next.targets, previous.targets);
  assert.notEqual(next.targets, previous.targets, "target arrays are independent");
  assert.equal(next.style, "dust");
  assert.equal(next.params.dustFill, presetValues("deep").dustFill);
});

test("platform art uses the requested source mask and leaves the editable recipe intact", () => {
  const recipe = defaultRecipe();
  recipe.params.mask = "macOS";
  recipe.lightGround = "#F5F1E9";
  recipe.darkGround = "#0A0C12";
  const original = cloneRecipe(recipe);
  const ios = artParams(recipe, "light", { mask: "square" });
  assert.equal(ios.mask, "square", "iOS receives unmasked source artwork");
  assert.equal(ios.ground, "solid");
  assert.equal(ios.groundInk, "#F5F1E9");
  assert.equal(ios.ink, "#000000");
  assert.equal(ios.invert, false, "plain light art does not invert its own white ground");
  const front = artParams(recipe, "dark", { mask: "square", markOnly: true });
  assert.equal(front.mask, "square", "visionOS layers are not circularly pre-cropped");
  assert.equal(front.ground, "none");
  assert.equal(front.ink, "#FFFFFF");
  const template = artParams(recipe, "light", { markOnly: true, monochrome: true });
  assert.equal(template.ground, "none");
  assert.equal(template.ink, "#000000");
  assert.equal(template.livEdgeFlow, 0, "template output has no colored edge lights");
  assert.deepEqual(recipe, original);
});

test("at-rest icons keep their authored resting twist while a motion snapshot remains opt-in", () => {
  const recipe = defaultRecipe();
  Object.assign(recipe.params, { livPose: "in motion", livRestTwist: 37, livRestLights: 0.45 });
  const resting = artParams(recipe);
  assert.equal(resting.livPose, "at rest");
  assert.equal(resting.livRestTwist, 37);
  assert.equal(resting.livRestLights, 0.45);
  recipe.iconAtRest = false;
  assert.equal(artParams(recipe).livPose, "in motion");
});

test("filenames derived from project names cannot escape their export directory", () => {
  for (const name of ["../Hello World", "C:\\icons\\app", "/tmp/a", "∞", ""]) {
    assert.match(slug(name), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

// Read the produced SVG's line segments rather than copying the ribbon's geometry math. The
// source exporter draws its outline and lights as M/L paths. Affine group transforms are
// included so either a geometry fit or a surrounding fit transform can satisfy the contract.
function radialExtent(svg, size) {
  const stack = [[1, 0, 0, 1, 0, 0]];
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  function transform(text = "") {
    let matrix = [1, 0, 0, 1, 0, 0];
    for (const [, kind, args] of text.matchAll(/(translate|scale|matrix)\(([^)]+)\)/g)) {
      const n = args.trim().split(/[ ,]+/).map(Number);
      const next =
        kind === "translate"
          ? [1, 0, 0, 1, n[0], n[1] ?? 0]
          : kind === "scale"
            ? [n[0], 0, 0, n[1] ?? n[0], 0, 0]
            : n;
      matrix = multiply(matrix, next);
    }
    return matrix;
  }
  let radius = 0;
  let segments = 0;
  for (const [tag] of svg.matchAll(/<g\b[^>]*>|<\/g\s*>|<path\b[^>]*>/g)) {
    if (tag.startsWith("</")) {
      stack.pop();
      continue;
    }
    const local = transform(tag.match(/\btransform="([^"]*)"/)?.[1]);
    const matrix = multiply(stack.at(-1), local);
    if (tag.startsWith("<g")) {
      stack.push(matrix);
      continue;
    }
    const path = tag.match(/\bd="([^"]*)"/)?.[1];
    if (!path || !/^[MLZ0-9., e+-]+$/i.test(path)) continue;
    const numbers = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    const stroke = Number(tag.match(/\bstroke-width="([^"]*)"/)?.[1] ?? 0);
    const scale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
    for (let i = 0; i < numbers.length; i += 2) {
      const x = matrix[0] * numbers[i] + matrix[2] * numbers[i + 1] + matrix[4];
      const y = matrix[1] * numbers[i] + matrix[3] * numbers[i + 1] + matrix[5];
      radius = Math.max(radius, Math.hypot(x - size / 2, y - size / 2) + (stroke * scale) / 2);
      segments++;
    }
  }
  assert.ok(segments > 100, "the measurement includes the actual ribbon and its edge lights");
  return radius;
}

test("maskable artwork remains in the safe circle after valid extreme geometry edits", () => {
  const recipe = defaultRecipe();
  Object.assign(recipe.params, {
    livWidth: 1.35,
    livHeight: 0.65,
    livThickness: 0.11,
    livRotation: 45,
    livDepth: 0.6,
    livPerspective: 1.2,
    livTaper: 0.65,
    livPinch: 0,
    livScale: 1.4,
    zoom: 4,
  });
  const size = 1024;
  const svg = createRenderer().svg(recipe, { size, maskable: true, layer: "mark" });
  const radius = radialExtent(svg, size);
  assert.ok(
    radius <= size * 0.4,
    `ribbon radius ${radius.toFixed(2)} exceeds the ${(size * 0.4).toFixed(2)}px safe circle`,
  );
});

test("maskable exports protect the ribbon and its glow across edited proportions and motion snapshots", () => {
  let seed = 0x98765432;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const fields = [
    "livWidth",
    "livHeight",
    "livThickness",
    "livRotation",
    "livDepth",
    "livPerspective",
    "livTaper",
    "livPinch",
    "livScale",
    "zoom",
    "livTilt",
    "livFocus",
    "livAsymmetry",
    "livEdgeWidth",
    "livLineGlow",
    "livLineGlowWidth",
    "livHairline",
    "livMinWidth",
  ];
  const renderer = createRenderer();
  for (let i = 0; i < 24; i++) {
    const recipe = defaultRecipe();
    recipe.iconAtRest = i % 2 === 0;
    recipe.params.livPose = "in motion";
    recipe.time = i * 0.313;
    for (const field of fields) {
      const meta = PARAMS[field];
      let value = i % 4 === 0 ? meta.max : meta.min + (meta.max - meta.min) * random();
      if (meta.step >= 1) value = Math.round(value);
      recipe.params[field] = value;
    }
    const size = [192, 512, 1024][i % 3];
    const svg = renderer.svg(recipe, { size, maskable: true, layer: "mark" });
    const radius = radialExtent(svg, size);
    assert.ok(
      radius <= size * 0.4,
      `case ${i}: ${radius.toFixed(3)}px radius exceeds ${size * 0.4}px at ${size}px`,
    );
  }
});
