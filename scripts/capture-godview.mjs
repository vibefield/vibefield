#!/usr/bin/env node
// THE BEFORE/AFTER CAPTURE TOOL (MV-3c; build-mv M30, M31, M32) — `pnpm capture:godview`.
// Launches the product in the Godview lab (`electron-shell/src/testing/godview-capture.ts`)
// once per arm and diffs what the compositor drew:
//
//   · A/B (two roots): A, A′ (A again — the A/A control) and B. B's source is
//     its MODEL STREAM after MV-3b (as the perf runner's), A keeps the fold
//     corpus. Every capture reads its A/A difference beside its A/B one.
//   · A/A (one root, the default: this checkout): A and A′ only — the control
//     itself, the proof that a capture of the same build reproduces.
//
// Each capture is one theme × view × fixed frame of a replayed corpus, with the
// page's clock frozen at that frame's corpus wall, the timezone UTC, the locale
// en-US, ambient animations off and reduced motion emulated — the same window
// mode as the perf runner (offscreen by default, never focused, M31). Captures
// are raw BGRA (diffed) plus PNG (to look at); every differing capture gets a
// diff picture. A sanity row proves the diff can see: each view's dark and
// light captures must differ.
//
//   node scripts/capture-godview.mjs [--a <root>] [--b <root>] [--out <dir>]
//     [--recipe n=20,duration=8000,seed=1] [--frames 2500,7900]
//     [--views swarm,list,rain,timeline] [--themes dark,light]
//     [--threshold 0.001] [--tolerance 24] [--scale 2] [--window offscreen|shown]
//     [--source-a fold|model] [--source-b fold|model] [--motion reduce|normal] [--no-build]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { diffBitmaps, diffImage, encodePng, judgeCapture } from "./capture-godview-diff.mjs";
import { buildRoot, builtBundle, launchLab, log, modelStreams } from "./godview-lab-arms.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const rootA = resolve(option("a", repoRoot));
const rootB = resolve(option("b", rootA));
const paired = rootA !== rootB;
const recipe = option("recipe", "n=20,duration=8000,seed=1");
const frames = option("frames", "2500,7900");
const views = option("views", "swarm,list,rain,timeline");
const themes = option("themes", "dark,light");
const threshold = Number(option("threshold", "0.001"));
const tolerance = Number(option("tolerance", "24"));
const scale = option("scale", "2");
const windowMode = option("window", "offscreen") === "shown" ? "shown" : "offscreen";
const motion = option("motion", "reduce") === "normal" ? "normal" : "reduce";
const sourceA = option("source-a", "fold") === "model" ? "model" : "fold";
const sourceB = option("source-b", paired ? "model" : sourceA) === "model" ? "model" : "fold";
const build = !argv.includes("--no-build");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(
  option("out", join(repoRoot, ".vibefield", "perf", "godview", "captures", stamp)),
);
mkdirSync(outDir, { recursive: true });

/** A first, its A/A control A′ next, then B. */
const ARMS = {
  A: { root: rootA, source: sourceA, dir: "A" },
  "A′": { root: rootA, source: sourceA, dir: "A2" },
  ...(paired ? { B: { root: rootB, source: sourceB, dir: "B" } } : {}),
};

async function captureArm(arm, spec) {
  const dir = join(outDir, spec.dir);
  const code = await launchLab({
    root: spec.root,
    env: {
      VF_GODVIEW_LAB: "capture",
      VF_GODVIEW_CAPTURE_OUT: dir,
      VF_GODVIEW_CAPTURE_RECIPE: recipe,
      VF_GODVIEW_CAPTURE_FRAMES: frames,
      VF_GODVIEW_CAPTURE_THEMES: themes,
      VF_GODVIEW_CAPTURE_MOTION: motion,
      VF_GODVIEW_PERF_VIEWS: views,
      VF_GODVIEW_PERF_SOURCE: spec.source,
      ...(spec.modelDir !== undefined ? { VF_GODVIEW_PERF_MODEL_DIR: spec.modelDir } : {}),
      VF_GODVIEW_PERF_WINDOW: windowMode,
      VF_GODVIEW_PERF_SCALE: scale,
    },
    logPath: join(outDir, `${spec.dir}.log`),
    echo: "GODVIEW_CAPTURE",
    prefix: arm,
  });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (code !== 0)
    throw new Error(`arm ${arm} exited ${code} (log: ${join(outDir, `${spec.dir}.log`)})`);
  return { dir, manifest };
}

const bitmap = (dir, name) => gunzipSync(readFileSync(join(dir, `${name}.bgra.gz`)));

const pct = (fraction) => `${(fraction * 100).toFixed(3)} %`;

async function main() {
  log(`godview captures · ${paired ? "A/B" : "A/A"} · out ${outDir}`);
  for (const [arm, { root, source }] of Object.entries(ARMS)) log(`${arm} ${root} (${source})`);
  if (build) {
    for (const root of new Set(Object.values(ARMS).map((spec) => spec.root))) {
      await buildRoot(root, join(outDir, `build-${root === rootA ? "A" : "B"}.log`));
    }
  }
  for (const [arm, { root }] of Object.entries(ARMS)) {
    if (builtBundle(root) === null) {
      log(
        `arm ${arm}: ${root} is not built — run pnpm --filter @vibefield/desktop build:all there`,
      );
      process.exit(2);
    }
  }
  const streams = new Map();
  for (const [arm, spec] of Object.entries(ARMS)) {
    if (spec.source !== "model") continue;
    if (!streams.has(spec.root)) {
      const name = arm === "B" ? "B" : "A";
      streams.set(
        spec.root,
        await modelStreams(
          spec.root,
          join(outDir, `model-streams-${name}`),
          recipe,
          join(outDir, `model-streams-${name}.log`),
        ),
      );
    }
    spec.modelDir = streams.get(spec.root);
  }

  const held = {};
  for (const [arm, spec] of Object.entries(ARMS)) {
    log(`arm ${arm}`);
    held[arm] = await captureArm(arm, spec);
  }

  const diffDir = join(outDir, "diff");
  mkdirSync(diffDir, { recursive: true });
  const rows = [];
  for (const shot of held.A.manifest.captures) {
    const { name, width, height } = shot;
    const twin = held["A′"].manifest.captures.find((other) => other.name === name);
    const other = paired ? held.B.manifest.captures.find((each) => each.name === name) : undefined;
    if (twin === undefined || (paired && other === undefined)) {
      rows.push({ name, verdict: "missing" });
      continue;
    }
    const a = bitmap(held.A.dir, name);
    const a2 = bitmap(held["A′"].dir, name);
    const aa = diffBitmaps(a, a2, width, height, tolerance);
    let ab;
    if (other !== undefined) {
      const b = bitmap(held.B.dir, name);
      ab = diffBitmaps(a, b, width, height, tolerance);
      if (ab.differing > 0 && !ab.sizeMismatch) {
        writeFileSync(
          join(diffDir, `${name}-AB.png`),
          encodePng(diffImage(a, b, width, height, tolerance), width, height),
        );
      }
    }
    if (aa.differing > 0 && !aa.sizeMismatch) {
      writeFileSync(
        join(diffDir, `${name}-AA.png`),
        encodePng(diffImage(a, a2, width, height, tolerance), width, height),
      );
    }
    const contents = [shot.content, twin.content, ...(other ? [other.content] : [])];
    rows.push({
      name,
      view: shot.view,
      theme: shot.theme,
      t: shot.t,
      size: `${width}×${height}`,
      aa,
      ...(ab !== undefined ? { ab } : {}),
      contents,
      swarmRenderer: shot.swarmRenderer,
      ...judgeCapture({ aa, ab, threshold, contents }),
    });
  }

  // the sanity row: the diff must see a theme change on every view
  const sanity = [];
  const [themeA, themeB] = themes.split(",");
  for (const shot of held.A.manifest.captures.filter((each) => each.theme === themeA)) {
    const flipped = held.A.manifest.captures.find(
      (each) => each.view === shot.view && each.t === shot.t && each.theme === themeB,
    );
    if (flipped === undefined) continue;
    const seen = diffBitmaps(
      bitmap(held.A.dir, shot.name),
      bitmap(held.A.dir, flipped.name),
      shot.width,
      shot.height,
      tolerance,
    );
    sanity.push({
      pair: `${shot.name} vs ${flipped.name}`,
      fraction: seen.fraction,
      seen: seen.fraction > threshold,
    });
  }

  const counts = {};
  for (const row of rows) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  const blind = sanity.filter((row) => !row.seen);
  const summary = {
    mode: paired ? "A/B" : "A/A",
    arms: Object.fromEntries(
      Object.entries(ARMS).map(([arm, { root, source }]) => [arm, { root, source }]),
    ),
    recipe,
    frames,
    views,
    themes,
    threshold,
    tolerance,
    scale,
    window: windowMode,
    motion,
    pinned: held.A.manifest.pinned,
    counts,
    sanity,
    rows,
  };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    `# Godview captures — ${paired ? "A/B" : "A/A (the control)"}`,
    "",
    ...Object.entries(ARMS).map(
      ([arm, { root, source }]) => `- ${arm}: \`${root}\` (source: ${source})`,
    ),
    `- corpus \`${recipe}\`, frames ${frames} ms, themes ${themes}, views ${views}`,
    `- window ${windowMode}, scale ${scale}; clock frozen per frame; pinned ${JSON.stringify(held.A.manifest.pinned)}; motion ${motion}`,
    `- a pixel differs past ${tolerance}/255 on any channel; a capture differs past ${pct(threshold)} of its pixels, or past twice its own A/A share when that already exceeds the threshold`,
    `- verdicts: ${Object.entries(counts)
      .map(([verdict, count]) => `${verdict} ${count}`)
      .join(" · ")}`,
    `- sanity (the diff sees a theme change): ${sanity.length - blind.length}/${sanity.length}${blind.length > 0 ? ` — BLIND on ${blind.map((row) => row.pair).join(", ")}` : ""}`,
    "",
    paired
      ? "| capture | A/A differs | A/B differs | A/B box | verdict |"
      : "| capture | A/A differs | max Δ | box | verdict |",
    "|---|---|---|---|---|",
  ];
  const box = (diff) =>
    diff?.box ? `${diff.box.x0},${diff.box.y0}–${diff.box.x1},${diff.box.y1}` : "–";
  for (const row of rows) {
    if (row.aa === undefined) {
      md.push(`| ${row.name} | – | – | – | ${row.verdict} |`);
      continue;
    }
    md.push(
      paired
        ? `| ${row.name} | ${pct(row.aa.fraction)} | ${pct(row.ab.fraction)} | ${box(row.ab)} | ${row.verdict} |`
        : `| ${row.name} | ${pct(row.aa.fraction)} | ${row.aa.maxDelta} | ${box(row.aa)} | ${row.verdict} |`,
    );
  }
  writeFileSync(join(outDir, "summary.md"), `${md.join("\n")}\n`);
  log(
    `verdicts: ${JSON.stringify(counts)} · sanity ${sanity.length - blind.length}/${sanity.length}`,
  );
  log(`written ${join(outDir, "summary.md")}`);
  const failed = (counts.blank ?? 0) + (counts.missing ?? 0) + (counts.size ?? 0) + blind.length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  log(`capture-godview failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
