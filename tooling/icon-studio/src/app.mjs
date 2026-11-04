import { PALETTES, PARAMS, paletteValues, SECTIONS } from "../vendor/wormhole.mjs";
import { buildBundle, bundleZip } from "./exports.mjs";
import { LIVING } from "./living-assets.mjs";
import {
  cloneRecipe,
  defaultRecipe,
  PLATFORMS,
  readRecipe,
  STARTERS,
  slug,
  starterRecipe,
} from "./model.mjs";
import { createRenderer } from "./render.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const renderer = createRenderer();
const STORAGE = "vibefield-icon-studio-v1";
const svgUrl = (source) => URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
let recipe = defaultRecipe();
let selected = "macos";
let version = 0;
let renderJob = null;
let dirty = false;
let renderTimer;
let playing = false;
let exporting = false;
let controller = null;
let downloadUrl = null;
const imageUrls = new Map();
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) recipe = readRecipe(JSON.parse(saved)).recipe;
} catch {
  /* A corrupt old recipe must not prevent a fresh workspace. */
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4000);
}
function notice(message = "") {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
function save() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(recipe));
    $("#save-status").textContent = "Saved on this device";
  } catch {
    $("#save-status").textContent = "Use Save recipe to keep edits";
  }
}
function download(name, data, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = el("a", { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function setImage(node, source) {
  if (!node) return;
  const key = node.id || node;
  const previous = imageUrls.get(key);
  const url =
    typeof source === "string"
      ? svgUrl(source)
      : URL.createObjectURL(new Blob([source], { type: "image/png" }));
  imageUrls.set(key, url);
  node.src = url;
  if (previous) URL.revokeObjectURL(previous);
}

for (const starter of STARTERS) {
  const dot = el("i");
  dot.style.background = starter.color;
  $("#starters").append(
    el(
      "button",
      {
        class: "starter",
        "data-starter": starter.id,
        "aria-pressed": "false",
        onclick: () => {
          stopMotion();
          recipe = starterRecipe(starter.id, recipe);
          notice();
          syncControls();
          change(true);
        },
      },
      dot,
      document.createTextNode(starter.name),
    ),
  );
}
$("#palette").append(
  el("option", { value: "own", text: "Own colors" }),
  ...PALETTES.map((p) => el("option", { value: p.id, text: p.name })),
);

const controlInputs = new Map();
// The identity is a flat ribbon. Inks and masks are chosen by the platform/appearance controls.
const excluded = new Set([
  "mask",
  "shadow",
  "ink",
  "mark",
  "livProfile",
  "livShading",
  "livEdge",
  "livGlow",
  "livSpectral",
  "livPearl",
  "livDrift",
  "livColorC",
  "winLogo",
  "winZoom",
]);
const dustSections = new Set(["dust", "rings", "run", "palette", "well", "light"]);
const sections = [
  SECTIONS.find((s) => s.id === "living"),
  SECTIONS.find((s) => s.id === "small"),
  ...SECTIONS.filter((s) => !["living", "small", "window"].includes(s.id)),
];
let count = 0;
for (const section of sections) {
  const entries = Object.entries(PARAMS).filter(
    ([key, p]) => p.section === section.id && !p.hidden && !excluded.has(key),
  );
  if (!entries.length) continue;
  count += entries.length;
  const details = el("details", { class: "control-section", "data-section": section.id });
  if (section.id === "living") details.open = true;
  details.append(
    el("summary", {}, document.createTextNode(section.title), el("span", { text: entries.length })),
  );
  for (const [key, meta] of entries) {
    const row = el("div", {
      class: "field parameter",
      "data-search": `${meta.label} ${key} ${section.title}`.toLowerCase(),
    });
    const label = el("label", { for: `param-${key}`, text: meta.label });
    const inputs = [];
    const commit = (value) => {
      recipe.params[key] =
        meta.type === "number" ? Math.max(meta.min, Math.min(meta.max, Number(value))) : value;
      if (meta.even) recipe.params[key] = Math.round(recipe.params[key] / 2) * 2;
      for (const input of inputs) {
        if (input.type === "checkbox") input.checked = recipe.params[key];
        else input.value = recipe.params[key];
      }
      change();
    };
    if (meta.type === "number") {
      const number = el("input", {
        class: "control-value",
        type: "number",
        min: meta.min,
        max: meta.max,
        step: meta.step,
        "aria-label": `${meta.label} value`,
        onchange: (e) => {
          if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber))
            commit(e.target.valueAsNumber);
          else e.target.value = recipe.params[key];
        },
      });
      const range = el("input", {
        id: `param-${key}`,
        type: "range",
        min: meta.min,
        max: meta.max,
        step: meta.step,
        oninput: (e) => commit(e.target.valueAsNumber),
      });
      inputs.push(range, number);
      label.append(number);
      row.append(label, range);
    } else if (meta.type === "select") {
      const select = el(
        "select",
        { id: `param-${key}`, onchange: (e) => commit(e.target.value) },
        ...meta.options.map((option) => el("option", { value: option, text: option })),
      );
      inputs.push(select);
      row.append(label, select);
    } else if (meta.type === "bool") {
      const check = el("input", {
        id: `param-${key}`,
        type: "checkbox",
        onchange: (e) => commit(e.target.checked),
      });
      inputs.push(check);
      label.append(check);
      row.append(label);
    } else {
      const color = el("input", {
        id: `param-${key}`,
        type: "color",
        oninput: (e) => commit(e.target.value.toUpperCase()),
      });
      inputs.push(color);
      row.append(label, color);
    }
    if (meta.hint) row.title = meta.hint;
    controlInputs.set(key, inputs);
    details.append(row);
  }
  $("#controls").append(details);
}
$("#parameter-count").textContent = `${count} controls`;

const formatLabels = {
  macos: ".icon + .icns",
  windows: ".ico",
  linux: ".png + .svg",
  ios: ".xcassets",
  visionos: ".xcassets",
  tray: ".png + .ico",
  web: ".svg + .ico",
  logo: ".svg",
};
for (const platform of PLATFORMS) {
  const input = el("input", {
    type: "checkbox",
    value: platform.id,
    "aria-label": `Include ${platform.name}`,
    onchange: (e) => {
      recipe.targets = e.target.checked
        ? [...new Set([...recipe.targets, platform.id])]
        : recipe.targets.filter((id) => id !== platform.id);
      syncTargets();
      save();
    },
  });
  $("#targets").append(
    el(
      "label",
      { class: "target-row" },
      input,
      el("span", { class: "target-name", text: platform.name }),
      el("span", { class: "target-format", text: formatLabels[platform.id] }),
    ),
  );
  const card = el("article", { class: "platform-card", "data-platform": platform.id });
  const img = el("img", {
    id: `preview-${platform.id}`,
    alt: `${platform.name} icon preview`,
    width: 76,
    height: 76,
  });
  const pick = el(
    "button",
    {
      class: "platform-pick",
      "aria-label": `Inspect ${platform.name}`,
      onclick: () => {
        selected = platform.id;
        syncSelected();
        change();
      },
    },
    el("div", {}, img),
    el("strong", { text: platform.name }),
    el("small", { text: platform.count }),
  );
  card.append(
    pick,
    el("button", {
      class: "platform-download",
      "data-export": platform.id,
      text: `Export ${formatLabels[platform.id]} ↓`,
    }),
  );
  $("#platform-cards").append(card);
}
for (const tone of ["light", "dark"])
  for (const size of [16, 20, 24, 32, 48, 64]) {
    $(`#small-${tone}`).append(
      el(
        "div",
        { class: "size-sample" },
        el("img", {
          id: `small-${tone}-${size}`,
          width: size,
          height: size,
          alt: `${size} pixel ${tone} icon`,
        }),
        el("span", { text: `${size}` }),
      ),
    );
  }
for (const [state, name] of [
  ["ready", "Ready"],
  ["update", "Update"],
  ["attention", "Attention"],
  ["offline", "Offline"],
]) {
  $("#tray-states").append(
    el(
      "div",
      { class: "tray-state" },
      el("img", {
        "data-tray": state,
        "data-tone": "light",
        width: 22,
        height: 22,
        alt: `${name} tray state`,
      }),
      el("span", { text: name }),
    ),
  );
}

function syncTargets() {
  $$("#targets input").forEach((input) => {
    input.checked = recipe.targets.includes(input.value);
  });
  $("#target-count").textContent = `${recipe.targets.length} selected`;
  $("#export-all").disabled = !recipe.targets.length || exporting;
  $("#export-panel-button").disabled = !recipe.targets.length || exporting;
}
function syncSelected() {
  $$(".platform-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.platform === selected);
  });
  const platform = PLATFORMS.find((p) => p.id === selected);
  $("#hero-platform").textContent = platform.name;
  $("#hero-spec").textContent =
    selected === "tray"
      ? "22 px template · enlarged for inspection"
      : selected === "web"
        ? "32 px favicon · enlarged for inspection"
        : selected === "logo"
          ? "Static vector · current artwork"
          : selected === "visionos"
            ? "1024 px layers · system crop preview"
            : "1024 px source · platform mask preview";
  $(".hero-art").className =
    `hero-art ${selected === "visionos" ? "circle" : selected === "ios" ? "ios" : selected === "tray" || selected === "web" ? "tray" : ""}`;
}
function syncControls() {
  $("#recipe-name").value = recipe.name;
  $("#field-style").value = recipe.style;
  $("#palette").value = PALETTES.some((p) => p.id === recipe.palette) ? recipe.palette : "own";
  $("#palette").disabled = recipe.style === "plain";
  $("#light-ground").value = recipe.lightGround;
  $("#dark-ground").value = recipe.darkGround;
  $("#time").value = recipe.time.toFixed(1);
  $("#icon-at-rest").checked = recipe.iconAtRest;
  $("#tray-weight").value = recipe.trayWeight;
  $("#tray-weight-value").textContent = `${recipe.trayWeight.toFixed(2)}×`;
  $("#favicon-weight").value = recipe.faviconWeight;
  $("#favicon-weight-value").textContent = `${recipe.faviconWeight.toFixed(2)}×`;
  $("#favicon-style").value = recipe.faviconStyle;
  for (const [key, inputs] of controlInputs)
    for (const input of inputs) {
      if (input.type === "checkbox") input.checked = recipe.params[key];
      else input.value = recipe.params[key];
    }
  for (const section of $$("#controls .control-section")) {
    const inactive = recipe.style === "plain" && dustSections.has(section.dataset.section);
    section.classList.toggle("inactive", inactive);
    section.title = inactive ? "Choose the Dust background to adjust this section." : "";
    section.querySelectorAll("input, select").forEach((input) => {
      input.disabled = inactive;
    });
  }
  $$("[data-starter]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.starter === recipe.starter));
  });
  $$("[data-appearance]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.appearance === recipe.appearance));
  });
  $("#artboard").classList.toggle("dark-preview", recipe.appearance !== "light");
  document.body.classList.toggle("dark-art", recipe.appearance !== "light");
  syncTargets();
  syncSelected();
}

function optionsFor(platform, appearance) {
  return {
    appearance,
    shape:
      platform === "macos"
        ? "macos"
        : platform === "windows" || platform === "linux" || platform === "web"
          ? "tile"
          : "square",
    purpose: platform === "tray" ? "tray" : platform === "web" ? "favicon" : "app",
    layer: platform === "logo" ? "mark" : "composite",
    maskable: platform === "visionos",
  };
}
function change(immediate = false) {
  save();
  version++;
  dirty = true;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderLatest, immediate ? 0 : 180);
}
async function renderLatest() {
  if (renderJob || exporting || playing) return;
  renderJob = (async () => {
    while (dirty && !exporting && !playing) {
      dirty = false;
      const mine = version;
      const snapshot = cloneRecipe(recipe);
      const cache = new Map();
      document.body.classList.add("busy");
      const image = async (node, size, options) => {
        if (mine !== version || exporting || playing) return;
        const key = `${size}:${JSON.stringify(options)}`;
        if (!cache.has(key)) cache.set(key, await renderer.png(snapshot, size, options));
        if (mine === version) setImage(node, cache.get(key));
      };
      try {
        const opts = optionsFor(selected, snapshot.appearance);
        await image($("#hero-image"), selected === "tray" ? 22 : selected === "web" ? 32 : 512, {
          ...opts,
          pointSize: selected === "tray" ? 22 : selected === "web" ? 32 : 1024,
        });
        for (const platform of PLATFORMS)
          await image(
            $(`#preview-${platform.id}`),
            platform.id === "tray" ? 22 : platform.id === "web" ? 32 : 128,
            optionsFor(platform.id, snapshot.appearance),
          );
        for (const tone of ["light", "dark"])
          for (const size of [16, 20, 24, 32, 48, 64])
            await image($(`#small-${tone}-${size}`), size, { appearance: tone, shape: "tile" });
        for (const node of $$("[data-tray]"))
          setImage(
            node,
            renderer.svg(snapshot, {
              size: Number(node.width) || 18,
              purpose: "tray",
              appearance: node.dataset.tone,
              state: node.dataset.tray,
            }),
          );
        await image($("#favicon-preview"), 16, {
          appearance: "light",
          shape: "tile",
          purpose: "favicon",
        });
        await image($("#touch-preview"), 180, {
          appearance: snapshot.appearance,
          shape: "square",
          opaque: true,
        });
        await image($("#spatial-back"), 256, {
          appearance: snapshot.appearance,
          shape: "square",
          layer: "background",
          opaque: true,
        });
        await image($("#spatial-front"), 256, {
          appearance: snapshot.appearance,
          shape: "square",
          layer: "mark",
          maskable: true,
        });
        if (mine === version) {
          $("#renderer-status").lastChild.textContent =
            snapshot.style === "dust" ? " WebGPU ready" : " Vector ready";
          $("#renderer-status").title = "Preview and export share the same renderer.";
          document.dispatchEvent(
            new CustomEvent("studio-rendered", {
              detail: { version: mine, style: snapshot.style },
            }),
          );
        }
      } catch (error) {
        notice(
          `${error.message} Plain artwork, tray icons, favicons, and SVG masters remain available. Dust artwork needs a browser with WebGPU enabled.`,
        );
        $("#renderer-status").lastChild.textContent = " Dust unavailable";
      }
      document.body.classList.remove("busy");
    }
  })().finally(() => {
    renderJob = null;
  });
  return renderJob;
}

$("#recipe-name").addEventListener("input", (e) => {
  recipe.name = e.target.value;
  save();
});
$("#field-style").addEventListener("change", (e) => {
  recipe.style = e.target.value;
  notice();
  syncControls();
  change(true);
});
$("#palette").addEventListener("change", (e) => {
  recipe.palette = e.target.value;
  if (recipe.palette !== "own")
    Object.assign(recipe.params, paletteValues(recipe.palette, "rings"));
  else {
    const clean = starterRecipe("wormhole");
    for (const [key, meta] of Object.entries(PARAMS))
      if (["palette", "run"].includes(meta.section)) recipe.params[key] = clean.params[key];
  }
  syncControls();
  change();
});
for (const [id, key] of [
  ["light-ground", "lightGround"],
  ["dark-ground", "darkGround"],
])
  $(`#${id}`).addEventListener("input", (e) => {
    recipe[key] = e.target.value.toUpperCase();
    change();
  });
for (const [id, key] of [
  ["tray-weight", "trayWeight"],
  ["favicon-weight", "faviconWeight"],
])
  $(`#${id}`).addEventListener("input", (e) => {
    recipe[key] = e.target.valueAsNumber;
    $(`#${id}-value`).textContent = `${recipe[key].toFixed(2)}×`;
    change();
  });
$("#favicon-style").addEventListener("change", (e) => {
  recipe.faviconStyle = e.target.value;
  change();
});
$$("[data-appearance]").forEach((button) => {
  button.addEventListener("click", () => {
    recipe.appearance = button.dataset.appearance;
    syncControls();
    change();
  });
});
$("#time").addEventListener("change", (e) => {
  recipe.time = Math.min(3600, Math.max(0, e.target.valueAsNumber || 0));
  change();
});
$("#icon-at-rest").addEventListener("change", (e) => {
  recipe.iconAtRest = e.target.checked;
  change();
});
$("#show-guide").addEventListener("change", (e) => {
  $("#safe-guide").hidden = !e.target.checked;
});
$("#explode").addEventListener("change", (e) => {
  $("#spatial-stage").classList.toggle("exploded", e.target.checked);
});
$("#control-search").addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase().trim();
  $$(".parameter").forEach((row) => {
    row.hidden = !row.dataset.search.includes(query);
  });
  $$("#controls details").forEach((details) => {
    details.hidden = ![...details.querySelectorAll(".parameter")].some((row) => !row.hidden);
    if (query && !details.hidden) details.open = true;
  });
});
$("#reset").addEventListener("click", () => {
  stopMotion();
  recipe = starterRecipe(recipe.starter, recipe);
  syncControls();
  notice();
  change(true);
  toast("Reset to the starting look.");
});
$("#save-recipe").addEventListener("click", () =>
  download(
    `${slug(recipe.name)}-icon-recipe.json`,
    JSON.stringify(recipe, null, 2),
    "application/json",
  ),
);
$("#import-button").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("A recipe must be smaller than 1 MB.");
    const result = readRecipe(JSON.parse(await file.text()));
    stopMotion();
    recipe = result.recipe;
    syncControls();
    change(true);
    notice(
      result.dropped.length
        ? `Imported the artwork. Unsupported or invalid fields were skipped: ${result.dropped.join(", ")}.`
        : "",
    );
    toast("Recipe imported.");
  } catch (error) {
    notice(`Could not import this recipe: ${error.message}`);
  }
  e.target.value = "";
});

let motionFrame = null;
function stopMotion() {
  playing = false;
  if (motionFrame !== null) cancelAnimationFrame(motionFrame);
  $("#play").textContent = "▷ Preview motion";
  $("#play").setAttribute("aria-pressed", "false");
}
$("#play").addEventListener("click", async () => {
  if (playing) {
    stopMotion();
    change(true);
    return;
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    toast("Reduce Motion is enabled. Use Frame to inspect a still.");
    return;
  }
  if (exporting) return;
  if (renderJob) await renderJob;
  playing = true;
  $("#play").textContent = "Ⅱ Pause motion";
  $("#play").setAttribute("aria-pressed", "true");
  const start = performance.now(),
    at = recipe.time;
  const tick = async () => {
    if (!playing) return;
    recipe.time = (at + (performance.now() - start) / 1000) % 3600;
    $("#time").value = recipe.time.toFixed(1);
    const moving = cloneRecipe(recipe);
    moving.iconAtRest = false;
    moving.params.livPose = "in motion";
    try {
      const rgba = await renderer.png(moving, 384, {
        ...optionsFor(selected, recipe.appearance),
        pointSize: 1024,
      });
      if (playing) setImage($("#hero-image"), rgba);
    } catch (error) {
      stopMotion();
      notice(error.message);
    }
    if (playing) motionFrame = requestAnimationFrame(tick);
  };
  motionFrame = requestAnimationFrame(tick);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) {
    stopMotion();
    save();
    dirty = true;
  } else if (!document.hidden) renderLatest();
});

async function exportSelection(targets) {
  if (exporting || !targets.length) return;
  stopMotion();
  clearTimeout(renderTimer);
  exporting = true;
  controller = new AbortController();
  syncTargets();
  const snapshot = cloneRecipe(recipe);
  $("#export-title").textContent = "Building your collection.";
  $("#export-progress").textContent = "Finishing the current preview…";
  $("#export-result").replaceChildren();
  $("#export-meter").value = 0;
  $("#cancel-export").hidden = false;
  $("#close-export").hidden = true;
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  $("#export-dialog").showModal();
  try {
    if (renderJob) await renderJob;
    const files = await buildBundle(snapshot, renderer, {
      targets,
      signal: controller.signal,
      onProgress: (progress) => {
        $("#export-progress").textContent = progress.label;
        $("#export-meter").value = progress.done / Math.max(1, progress.total);
      },
    });
    if (controller.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
    $("#export-progress").textContent = "Packing the ZIP…";
    const zip = bundleZip(files);
    downloadUrl = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    const filename = `${slug(snapshot.name)}-${targets.length === 1 ? targets[0] : "icon-collection"}.zip`;
    const link = el("a", { href: downloadUrl, download: filename, text: `Download ${filename}` });
    $("#export-title").textContent = "Your collection is ready.";
    $("#export-progress").textContent =
      `${files.length} files · ${(zip.byteLength / 1048576).toFixed(2)} MB · ${targets.length} export ${targets.length === 1 ? "set" : "sets"}`;
    $("#export-meter").value = 1;
    $("#export-result").append(
      link,
      el("p", {
        text: "The bundle includes your recipe and integration instructions. Apple source catalogs are ready for Xcode to compile; native appearance can differ from this browser preview.",
      }),
    );
    link.click();
  } catch (error) {
    $("#export-title").textContent =
      error.name === "AbortError" ? "Export cancelled." : "Export could not finish.";
    $("#export-progress").textContent =
      error.name === "AbortError" ? "Your artwork and recipe are unchanged." : error.message;
  } finally {
    exporting = false;
    $("#cancel-export").hidden = true;
    $("#close-export").hidden = false;
    syncTargets();
    if (dirty) renderLatest();
  }
}
$("#export-all").addEventListener("click", () => exportSelection(recipe.targets));
$("#export-panel-button").addEventListener("click", () => exportSelection(recipe.targets));
$$("[data-export]").forEach((button) => {
  button.addEventListener("click", () => exportSelection([button.dataset.export]));
});
$("#cancel-export").addEventListener("click", () => {
  controller?.abort();
  $("#export-progress").textContent = "Cancelling after the current image…";
});
$("#close-export").addEventListener("click", () => $("#export-dialog").close());
$("#export-dialog").addEventListener("cancel", (event) => {
  if (exporting) {
    event.preventDefault();
    controller?.abort();
  }
});
$("#download-page").addEventListener("click", async () => {
  try {
    // The original source is saved before any live DOM edits or blob URLs are introduced.
    const source = globalThis.__ICON_STUDIO_SOURCE__ ?? (await (await fetch(location.href)).text());
    download("VibeField Icon Studio.html", source, "text/html");
    toast("Portable studio saved. Save your recipe alongside it.");
  } catch {
    toast("This is already the portable HTML. Keep this file and save your recipe alongside it.");
  }
});

setImage($("#brand-mark"), LIVING.light);
setImage($("#living-light"), LIVING.light);
setImage($("#living-dark"), LIVING.dark);
// Immediate, vector-only first paint; the full preview queue replaces these with export pixels.
setImage(
  $("#hero-image"),
  renderer.svg(recipe, { size: 512, shape: "macos", appearance: recipe.appearance }),
);
syncControls();
change(true);

// A small explicit QA door, built from the same paths as the visible controls. No network or host access.
globalThis.__iconStudio = {
  get recipe() {
    return cloneRecipe(recipe);
  },
  get ready() {
    return !renderJob && !dirty;
  },
  get errors() {
    return renderer.errors;
  },
  async settle() {
    clearTimeout(renderTimer);
    await renderLatest();
    if (renderJob) await renderJob;
  },
  async verifyExports(targets = recipe.targets) {
    await this.settle();
    const files = await buildBundle(cloneRecipe(recipe), renderer, { targets });
    return { files, zip: bundleZip(files) };
  },
};
addEventListener("pagehide", () => {
  stopMotion();
  renderer.dispose();
});
