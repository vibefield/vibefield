// DS-5d, 2026-10-01 — the ICE side of COMPACTION (design-06 §4; the wave-3
// ruling of 12:30). A canvas the host compacts is served as an ICE1 envelope
// whose payload is a Loro SHALLOW snapshot — loro-crdt 1.13.8 cannot export a
// full snapshot from a doc that holds a shallow history, so the spike's
// "the payload is a FULL Loro snapshot (never shallow)" holds only for a canvas
// never compacted. What has to hold instead: ICE itself opens that envelope,
// keeps editing on it, and what ICE writes next folds back into the host.
//
// Like generate.mjs (whose fixtures this leaves untouched), THIS file is the
// only one here that links ICE — through the RENDERER's dependency graph,
// because fieldd must never depend on it. ice1-compacted.test.ts reads the
// fixtures with loro-crdt alone.
//
// Run from the repo root:  node packages/fieldd/test/probes/ice1-envelope/generate-compacted.mjs
// Peer ids are random per LoroDoc, so a rerun rewrites every fixture; the
// probe asserts relations, never bytes.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..", "..");
const fromApp = createRequire(join(repo, "packages", "field-app", "package.json"));
const ice = await import(pathToFileURL(fromApp.resolve("@vibecook/ice")).href);
const loro = await import(pathToFileURL(fromApp.resolve("loro-crdt")).href);
const icePkg = fromApp("@vibecook/ice/package.json");
const { createCanvasEngine, defineWidget, defineQuery, Position, PrefabId } = ice;
const { LoroDoc, decodeImportBlobMeta } = loro;

const fixtures = join(here, "fixtures-compacted");
rmSync(fixtures, { recursive: true, force: true });
mkdirSync(fixtures, { recursive: true });

// ---- the fixed header rule, ICE-free (the rule the probes prove) ----
const MAGIC = [0x49, 0x43, 0x45, 0x31]; // "ICE1"
function lift(bytes) {
  if (bytes.byteLength < 9 || !MAGIC.every((b, i) => bytes[i] === b)) throw new Error("not ICE1");
  if (bytes[4] !== 1) throw new Error(`envelope version ${bytes[4]}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(5, true);
  return { header: bytes.subarray(9, 9 + headerLen), payload: bytes.subarray(9 + headerLen) };
}
function wrap(headerBytes, payload) {
  const out = new Uint8Array(9 + headerBytes.byteLength + payload.byteLength);
  out.set(MAGIC, 0);
  out[4] = 1;
  new DataView(out.buffer).setUint32(5, headerBytes.byteLength, true);
  out.set(headerBytes, 9);
  out.set(payload, 9 + headerBytes.byteLength);
  return out;
}
const modeOf = (bytes) => decodeImportBlobMeta(bytes, false).mode;

// ---- one window = one engine + one autosave, driven by hand (generate.mjs's shape) ----
const Card = defineWidget({ type: "probe.card", surface: "dom", component: () => null });
const widgetQ = defineQuery([Position, PrefabId]);
let clock = 1_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function window(name, initial) {
  const ce = createCanvasEngine({ widgets: [Card] });
  if (initial === null) ce.docs.create();
  else {
    const res = ce.docs.open(initial);
    if (!res.ok) throw new Error(`${name}: ICE refused the envelope — ${res.reason}`);
  }
  ce.world.sync();
  const timers = [];
  const calls = [];
  const autosave = ce.docs.autosave(
    {
      put: (bytes) => void calls.push({ call: "put", bytes: bytes.slice() }),
      append: (bytes) => void calls.push({ call: "append", bytes: bytes.slice() }),
    },
    {
      now: () => clock,
      schedule: (fn) => {
        timers.push(fn);
        return () => {
          const at = timers.indexOf(fn);
          if (at >= 0) timers.splice(at, 1);
        };
      },
    },
  );
  return {
    ce,
    calls,
    autosave,
    async tick() {
      for (let round = 0; round < 4; round += 1) {
        clock += 1_000;
        for (const fn of timers.splice(0)) fn();
        await sleep(5);
      }
    },
    spawn(x) {
      ce.ops.spawnWidget("probe.card", { x, y: 10, w: 100, h: 60 });
      ce.world.sync();
    },
    widgets() {
      let n = 0;
      ce.world.query(widgetQ).each((batch) => {
        for (const _ of batch) n += 1;
      });
      return n;
    },
  };
}

const files = {};
function save(file, bytes) {
  writeFileSync(join(fixtures, file), bytes);
  files[file] = bytes;
  return file;
}

// 1. A window makes a canvas: its forced first checkpoint, then a journal.
const W1 = window("W1", null);
await W1.tick();
for (const x of [0, 120, 240, 360]) {
  W1.spawn(x);
  await W1.tick();
}
const puts = W1.calls.filter((c) => c.call === "put");
const appends = W1.calls.filter((c) => c.call === "append");

// 2. The host's state (checkpoint + journal), COMPACTED at its head and framed
//    by the rule under the newest checkpoint's header — what fieldd serves.
const host = new LoroDoc();
host.import(lift(puts[0].bytes).payload);
for (const c of appends) host.import(c.bytes);
const shallow = host.export({ mode: "shallow-snapshot", frontiers: host.oplogFrontiers() });
const base = save("compacted-base.ice1", wrap(lift(puts.at(-1).bytes).header, shallow));

// 3. ICE opens it, and the window keeps editing on it.
const W2 = window("W2", files[base]);
const openedWidgets = W2.widgets();
await W2.tick();
W2.spawn(480);
await W2.tick();
W2.spawn(600);
await W2.tick();
const w2puts = W2.calls.filter((c) => c.call === "put");
const w2appends = W2.calls.filter((c) => c.call === "append");
const windowCheckpoint = save("window-checkpoint.ice1", w2puts.at(-1).bytes);
const windowAppends = w2appends.map((c, i) => save(`window-append-${i + 1}.loro`, c.bytes));

// 4. What ICE wrote next folds back into the compacted host.
const back = new LoroDoc();
back.import(lift(files[base]).payload);
const results = {};
for (const [label, bytes] of [
  ["windowCheckpoint", lift(files[windowCheckpoint]).payload],
  ...windowAppends.map((file) => [file, files[file]]),
]) {
  try {
    const status = back.import(bytes);
    results[label] = status.pending === null ? "applied" : "pending";
  } catch (error) {
    results[label] = `refused: ${String(error).split("\n")[0]}`;
  }
}

const manifest = {
  probe: "DS-5d compacted ICE1 envelope, 2026-10-01",
  ice: icePkg.version,
  loro: fromApp("loro-crdt/package.json").version,
  window1: { widgets: W1.widgets(), puts: puts.length, appends: appends.length },
  base: {
    file: base,
    headerFrom: "the window's newest checkpoint",
    payloadMode: modeOf(lift(files[base]).payload),
    fullSnapshotExportMode: modeOf(back.export({ mode: "snapshot" })),
  },
  iceOpened: { ok: true, widgets: openedWidgets },
  window2: {
    widgets: W2.widgets(),
    checkpoint: {
      file: windowCheckpoint,
      payloadMode: modeOf(lift(files[windowCheckpoint]).payload),
    },
    appends: windowAppends,
  },
  hostTakesWhatIceWrote: results,
};
writeFileSync(join(fixtures, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await W1.autosave.close().catch(() => {});
await W2.autosave.close().catch(() => {});
console.log(JSON.stringify(manifest, null, 2));
console.log("fixtures:", readdirSync(fixtures).sort().join(" "));
