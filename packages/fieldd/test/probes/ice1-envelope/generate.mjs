// DS-5 spike, 2026-09-30 — the ICE1 checkpoint envelope (thinking-desktop-sync-plane §5.1).
//
// Writes REAL checkpoints and journal records through ICE 0.11.0's OWN autosave
// path — the renderer's persistence-controller shape exactly: `put` receives a
// checkpoint, `append` receives an update record — for two devices playing the
// §1.2 defect: A checkpoints edits that live in no journal record while B holds
// content of its own. fieldd's probe (ice1-envelope.test.ts) reads the fixtures
// WITHOUT ICE; this script is the only file here that links ICE, and it resolves
// ICE through the RENDERER's dependency graph because fieldd must never depend
// on it. It also closes the loop from ICE's side: an envelope rebuilt by the
// fixed header rule over a Loro-merged snapshot is opened by ICE itself, and a
// live window is pushed a host's update without quarantining.
//
// Run from the repo root:  node packages/fieldd/test/probes/ice1-envelope/generate.mjs
// Peer ids are random per LoroDoc, so a rerun rewrites every fixture; the probe
// asserts relations, never bytes.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..", "..");
const fromApp = createRequire(join(repo, "packages", "field-app", "package.json"));
const iceEntry = fromApp.resolve("@vibecook/ice");
const ice = await import(pathToFileURL(iceEntry).href);
const loro = await import(pathToFileURL(fromApp.resolve("loro-crdt")).href);
const icePkg = fromApp("@vibecook/ice/package.json");
const { createCanvasEngine, defineWidget, defineQuery, Position, PrefabId } = ice;
const { LoroDoc } = loro;

const fixtures = join(here, "fixtures");
rmSync(fixtures, { recursive: true, force: true });
mkdirSync(fixtures, { recursive: true });

// ---- the fixed header rule, ICE-free (the same rule the probe proves) ----
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
const vvJson = (vv) => Object.fromEntries([...vv.toJSON()].map(([p, c]) => [String(p), c]));

// ---- one device = one engine + one autosave, driven by hand ----
const Card = defineWidget({ type: "probe.card", surface: "dom", component: () => null });
const widgetQ = defineQuery([Position, PrefabId]);
let clock = 1_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function device(name, initial) {
  const ce = createCanvasEngine({ widgets: [Card] });
  let session;
  if (initial === null) session = ce.docs.create();
  else {
    const res = ce.docs.open(initial.bytes);
    if (!res.ok) throw new Error(`${name}: open failed — ${res.reason}`);
    session = res.session;
    for (const update of initial.updates) session.applyRemote(update);
  }
  ce.world.sync();
  const timers = [];
  const calls = []; // storage calls in the order autosave made them
  const tap = []; // EVERY local commit the store emitted, appended or not
  session.store.subscribeOutbound((bytes) => tap.push(bytes.slice()));
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
    session,
    calls,
    tap,
    autosave,
    /** fire every armed debounce timer and let the write loop drain */
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

// 1. A creates the canvas; its first autosave write is a forced checkpoint.
const A = device("A", null);
await A.tick();
A.spawn(0);
await A.tick();
A.spawn(120);
await A.tick();
// 2. B bootstraps from what fieldd would ship: A's checkpoint + A's journal.
const bootstrap = {
  bytes: A.calls[0].bytes,
  updates: A.calls.filter((c) => c.call === "append").map((c) => c.bytes),
};
const B = device("B", bootstrap);
await B.tick();
// 3. Concurrent edits: A journals one more; B journals two of its own.
A.spawn(240);
await A.tick();
B.spawn(-200);
await B.tick();
B.spawn(-320);
await B.tick();
// 4. THE DEFECT'S SHAPE: A edits twice and flushes before the debounce fires —
//    ICE folds both pending updates into a checkpoint and never appends them.
A.spawn(360);
A.spawn(480);
await A.autosave.flush();

function record(prefix, dev) {
  let checkpoints = 0;
  let updates = 0;
  const storage = dev.calls.map((c) =>
    c.call === "put"
      ? { call: "put", file: save(`${prefix}-checkpoint-${checkpoints++}.ice1`, c.bytes) }
      : { call: "append", file: save(`${prefix}-update-${++updates}.loro`, c.bytes) },
  );
  const appended = dev.calls.filter((c) => c.call === "append");
  const tap = dev.tap.map((bytes, index) => {
    const same = appended.findIndex(
      (c) => c.bytes.byteLength === bytes.byteLength && c.bytes.every((b, i) => b === bytes[i]),
    );
    if (same >= 0)
      return { seq: index + 1, appendedAs: storage.filter((s) => s.call === "append")[same].file };
    return {
      seq: index + 1,
      appendedAs: null,
      file: save(`${prefix}-tap-${index + 1}.loro`, bytes),
    };
  });
  return { storage, tap, widgets: dev.widgets() };
}
const devices = { A: record("a", A), B: record("b", B) };

// 5. The merge fieldd would do, with loro-crdt only: A's newest checkpoint,
//    B's checkpoint and B's journal, in one LoroDoc.
const aLast = A.calls.filter((c) => c.call === "put").at(-1).bytes;
const bFirst = B.calls.find((c) => c.call === "put").bytes;
const host = new LoroDoc();
host.import(lift(aLast).payload);
const windowFrom = host.oplogVersion(); // everything A's open window already holds
host.import(lift(bFirst).payload);
for (const c of B.calls.filter((c) => c.call === "append")) host.import(c.bytes);
const merged = wrap(lift(aLast).header, host.export({ mode: "snapshot" }));
save("merged-roundtrip.ice1", merged);

// 6. ICE opens the rule-built envelope — the host can serve a merged doc back.
const C = createCanvasEngine({ widgets: [Card] });
const opened = C.docs.open(merged);
if (!opened.ok) throw new Error(`ICE refused the rebuilt envelope: ${opened.reason}`);
C.world.sync();
let mergedWidgets = 0;
C.world.query(widgetQ).each((batch) => {
  for (const _ of batch) mergedWidgets += 1;
});

// 7. A LIVE window is pushed the host's update from what it holds, and ICE's
//    autosave re-journals the applied remote update (subscribeRemote).
const push = host.export({ mode: "update", from: windowFrom });
save("push-to-window-a.loro", push);
const before = A.widgets();
const appendsBefore = A.calls.filter((c) => c.call === "append").length;
let quarantined = null;
try {
  A.session.applyRemote(push);
  A.ce.world.sync();
} catch (error) {
  quarantined = String(error);
}
await A.tick();
const rejournal = A.calls.filter((c) => c.call === "append").slice(appendsBefore);

const manifest = {
  spike: "DS-5 ICE1 envelope, 2026-09-30",
  ice: icePkg.version,
  loro: fromApp("loro-crdt/package.json").version,
  devices,
  merged: {
    file: "merged-roundtrip.ice1",
    headerFrom: devices.A.storage.filter((s) => s.call === "put").at(-1).file,
    oplogVersion: vvJson(host.oplogVersion()),
    iceOpenedWidgets: mergedWidgets,
  },
  livePush: {
    file: "push-to-window-a.loro",
    windowFrom: vvJson(windowFrom),
    widgetsBefore: before,
    widgetsAfter: A.widgets(),
    quarantined,
    rejournaledAppends: rejournal.length,
    rejournaledIsPush:
      rejournal.length === 1 &&
      rejournal[0].bytes.byteLength === push.byteLength &&
      rejournal[0].bytes.every((b, i) => b === push[i]),
  },
};
writeFileSync(join(fixtures, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await A.autosave.close().catch(() => {});
await B.autosave.close().catch(() => {});
console.log(
  JSON.stringify(
    {
      devices: { A: devices.A.widgets, B: devices.B.widgets },
      merged: mergedWidgets,
      livePush: manifest.livePush,
    },
    null,
    2,
  ),
);
console.log("fixtures:", readdirSync(fixtures).sort().join(" "));
