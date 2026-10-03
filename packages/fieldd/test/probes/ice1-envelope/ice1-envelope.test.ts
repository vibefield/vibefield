// DS-5 spike, 2026-09-30 — the ICE1 checkpoint envelope (thinking-desktop-sync-plane
// §5.1, DS-D18's "the spike that comes first"). Three questions, answered against
// REAL bytes: `generate.mjs` wrote every fixture through ICE's own autosave path
// (put = checkpoint, append = journal record), two devices, the §1.2 defect.
// THIS file links no ICE and no strata — only loro-crdt, the tree's one pinned
// resolution (EL8) — which is exactly the posture the Loro-level host must keep.
//
// (a) Can fieldd lift the Loro snapshot out of a checkpoint by a FIXED header rule?
// (b) Does a fresh LoroDoc import that snapshot plus the journal fieldd already
//     keeps, and converge with a doc that saw the same records in another order?
// (c) Does ICE hand raw Loro updates beside its checkpoints — and does a
//     checkpoint's FOLDED edit also go out as an update, or only inside it?
//
// DK-4 (desk/landing, 2026-10-03): the fixtures are REGENERATED AT THE PINNED ICE —
// the desk's engine laying desk notes — and held to the pin (the manifest's `ice` is
// the workspace's own override). (d) proves the frame unchanged across the pins:
// 0.11.0's four checkpoints are kept as a golden the pinned writer re-framed byte
// for byte, and this rule reads both pins' frames alike — and reads the desk's types.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImportBlobMeta, LoroDoc, VersionVector } from "loro-crdt";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const bytesOf = (file: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, file)));

interface StorageCall {
  call: "put" | "append";
  file: string;
}
interface TapEntry {
  seq: number;
  appendedAs: string | null;
  file?: string;
}
interface GoldenRow {
  file: string;
  sha256: string;
  reframedSha256: string;
  identical: boolean;
  engineSchema: number;
}
interface Manifest {
  ice: string;
  loro: string;
  /** what the devices laid (DK-4: the desk's note) */
  objectType: string;
  golden: { ice: string; dir: string; files: GoldenRow[] };
  devices: Record<"A" | "B", { storage: StorageCall[]; tap: TapEntry[]; widgets: number }>;
  merged: {
    file: string;
    headerFrom: string;
    oplogVersion: Record<string, number>;
    iceOpenedWidgets: number;
  };
  livePush: {
    file: string;
    windowFrom: Record<string, number>;
    widgetsBefore: number;
    widgetsAfter: number;
    quarantined: string | null;
    rejournaledAppends: number;
    rejournaledIsPush: boolean;
  };
}
const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as Manifest;

// ---- the fixed header rule (ICE 0.11.0 `core/src/doc/envelope.ts`, read in dist) ----
//   [0..4)  magic "ICE1"   [4] envelope version = 1   [5..9) header length, u32 LE
//   [9..9+n) header, UTF-8 JSON   [9+n..end) payload = the Loro export, nothing after it
const MAGIC = [0x49, 0x43, 0x45, 0x31] as const;
type Lifted = { header: Uint8Array; payload: Uint8Array };
function lift(bytes: Uint8Array): Lifted {
  if (bytes.byteLength < 9) throw new Error("truncated");
  if (!MAGIC.every((b, i) => bytes[i] === b)) throw new Error("magic");
  if (bytes[4] !== 1) throw new Error("version");
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, true);
  if (9 + n > bytes.byteLength) throw new Error("header-overrun");
  return { header: bytes.subarray(9, 9 + n), payload: bytes.subarray(9 + n) };
}
function wrap({ header, payload }: Lifted): Uint8Array {
  const out = new Uint8Array(9 + header.byteLength + payload.byteLength);
  out.set(MAGIC, 0);
  out[4] = 1;
  new DataView(out.buffer).setUint32(5, header.byteLength, true);
  out.set(header, 9);
  out.set(payload, 9 + header.byteLength);
  return out;
}
const vvOf = (doc: LoroDoc): Record<string, number> =>
  Object.fromEntries([...doc.oplogVersion().toJSON()].map(([p, c]) => [String(p), c]));
const checkpoints = readdirSync(FIXTURES).filter((f) => f.endsWith(".ice1"));
const storage = (device: "A" | "B", call: "put" | "append"): string[] =>
  manifest.devices[device].storage.filter((s) => s.call === call).map((s) => s.file);

/** The workspace's ICE pin, read where it is declared (EL8): the `pnpm-workspace.yaml` override. */
function pinnedIce(): string {
  const workspace = readFileSync(
    join(HERE, "..", "..", "..", "..", "..", "pnpm-workspace.yaml"),
    "utf8",
  );
  const pin = /^\s+"@vibecook\/ice":\s*([^\s#]+)\s*$/m.exec(workspace)?.[1];
  if (pin === undefined) throw new Error("no @vibecook/ice override in pnpm-workspace.yaml");
  return pin;
}

describe("DS-5 spike (a) — the Loro bytes lift out of an ICE1 checkpoint by a fixed rule", () => {
  it("probes real renderer-written checkpoints, with no ICE or strata linked here", () => {
    // written at the PINNED ICE — move the pin and these fixtures must be regenerated (DK-4)
    expect(manifest.ice).toBe(pinnedIce());
    expect(manifest.loro).toBe("1.13.8");
    expect(checkpoints.length).toBeGreaterThanOrEqual(4);
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']@vibecook\//);
  });

  it.each(checkpoints)(
    "%s: magic, version, length-prefixed JSON header, then a FULL Loro snapshot",
    (file) => {
      const bytes = bytesOf(file);
      const { header, payload } = lift(bytes);
      const parsed = JSON.parse(new TextDecoder().decode(header)) as Record<string, unknown>;
      expect(Number.isSafeInteger(parsed["engineSchema"])).toBe(true);
      expect(typeof parsed["prefabVersions"]).toBe("object");
      // A full snapshot — never shallow: VibeField's autosave calls exportEnvelope,
      // which exports with no mode. A shallow base could not swap increments with
      // a full-history peer (strata's law 2), so the host must check this, not assume it.
      expect(decodeImportBlobMeta(payload, true).mode).toBe("snapshot");
      const doc = new LoroDoc();
      expect(doc.import(payload).pending).toBeNull();
      // The rule is the WHOLE frame: re-wrapping reproduces the checkpoint byte for byte
      // (no trailer, no checksum, nothing after the payload).
      expect(Buffer.compare(Buffer.from(wrap({ header, payload })), Buffer.from(bytes))).toBe(0);
    },
  );

  it("refuses what it cannot vouch for, by reason", () => {
    const good = bytesOf(storage("A", "put")[0] as string);
    const badMagic = good.slice();
    badMagic[0] = 0x58;
    const badVersion = good.slice();
    badVersion[4] = 2;
    const overrun = good.slice(0, 20);
    expect(() => lift(badMagic)).toThrow("magic");
    expect(() => lift(badVersion)).toThrow("version");
    expect(() => lift(good.slice(0, 8))).toThrow("truncated");
    expect(() => lift(overrun)).toThrow("header-overrun");
    // A journal record is not an envelope — the two species never confuse.
    expect(() => lift(bytesOf(storage("A", "append")[0] as string))).toThrow("magic");
  });
});

/** fieldd on A: its checkpoint and its journal, exactly as stored today. */
function hostA(): LoroDoc {
  const doc = new LoroDoc();
  doc.import(lift(bytesOf(storage("A", "put")[0] as string)).payload);
  for (const file of storage("A", "append")) expect(doc.import(bytesOf(file)).pending).toBeNull();
  return doc;
}
/** fieldd on B: B's checkpoint (bootstrapped from A) and B's own journal. */
function hostB(): LoroDoc {
  const doc = new LoroDoc();
  doc.import(lift(bytesOf(storage("B", "put")[0] as string)).payload);
  for (const file of storage("B", "append")) expect(doc.import(bytesOf(file)).pending).toBeNull();
  return doc;
}
/** One round of the proposed lane open: each side states its version vector
 * (as ENCODED bytes, the wire form); the other answers exactly what is missing. */
function exchange(x: LoroDoc, y: LoroDoc): { xToY: number; yToX: number } {
  const xVv = VersionVector.decode(x.oplogVersion().encode());
  const yVv = VersionVector.decode(y.oplogVersion().encode());
  const forY = x.export({ mode: "update", from: yVv });
  const forX = y.export({ mode: "update", from: xVv });
  expect(y.import(forY).pending).toBeNull();
  expect(x.import(forX).pending).toBeNull();
  return { xToY: forY.byteLength, yToX: forX.byteLength };
}

/** A doc's STATE for comparison. `toJSON()` lists a root container that holds
 * no ops (strata's `resources` map) only when a snapshot was the doc's FIRST
 * import — representation, not state: no op backs it, and ICE's store calls
 * `getMap("resources")` on open either way. Dropping empty roots compares what
 * the oplog actually says. */
function stateOf(doc: LoroDoc): Record<string, unknown> {
  const json = doc.toJSON() as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(json).filter(
      ([, value]) =>
        !(value !== null && typeof value === "object" && Object.keys(value).length === 0),
    ),
  );
}

describe("DS-5 spike (b) — import, journal, merge by version vector", () => {
  it("two holders with concurrent journals converge in ONE version-vector round", () => {
    const a = hostA();
    const b = hostB();
    expect(a.oplogVersion().compare(b.oplogVersion())).toBeUndefined(); // concurrent
    const sizes = exchange(a, b);
    expect(sizes.xToY).toBeGreaterThan(0);
    expect(sizes.yToX).toBeGreaterThan(0);
    expect(a.oplogVersion().compare(b.oplogVersion())).toBe(0);
    expect(stateOf(a)).toEqual(stateOf(b));
    // A second round is empty in substance: nothing left to say.
    const again = VersionVector.decode(b.oplogVersion().encode());
    const before = vvOf(b);
    b.import(a.export({ mode: "update", from: again }));
    expect(vvOf(b)).toEqual(before);
  });

  it("THE §1.2 DEFECT: a checkpoint folded on A reaches B, which already holds content — merged, not clobbered", () => {
    const b = hostB(); // B holds its own edits, none of which A has
    const bOwn = vvOf(b);
    const folded = lift(bytesOf(storage("A", "put").at(-1) as string)).payload;
    // Today: DocumentService declines this SNAPSHOT as `would-clobber` (doc-service.ts:704-711).
    // A Loro host simply imports it.
    expect(b.import(folded).pending).toBeNull();
    for (const [peer, counter] of Object.entries(bOwn)) {
      expect(b.oplogVersion().get(peer as `${number}`)).toBeGreaterThanOrEqual(counter); // B lost nothing
    }
    const a = hostA();
    a.import(folded); // A's host folds its own renderer's checkpoint the same way
    exchange(a, b);
    expect(vvOf(a)).toEqual(manifest.merged.oplogVersion);
    expect(vvOf(b)).toEqual(manifest.merged.oplogVersion);
    expect(stateOf(a)).toEqual(stateOf(b));
    // And ICE itself opened that merged state, rewrapped by the same rule, with every
    // widget from both devices (recorded by generate.mjs from ICE's own world).
    expect(manifest.merged.iceOpenedWidgets).toBe(
      manifest.devices.A.widgets + manifest.devices.B.widgets - 2, // the two they shared at bootstrap
    );
    const rebuilt = lift(bytesOf(manifest.merged.file));
    const fromRebuilt = new LoroDoc();
    fromRebuilt.import(rebuilt.payload);
    expect(vvOf(fromRebuilt)).toEqual(manifest.merged.oplogVersion);
  });

  it("a doc that saw every record in ANOTHER order — updates before their base — converges to the same version", () => {
    const z = new LoroDoc();
    const scrambled = [
      ...storage("B", "append").reverse(),
      ...storage("A", "append").reverse(),
    ].map(bytesOf);
    let sawPending = false;
    for (const update of scrambled) sawPending = z.import(update).pending !== null || sawPending;
    expect(sawPending).toBe(true); // held, not applied, not an error (C6-3f's Q2)
    z.import(lift(bytesOf(storage("B", "put")[0] as string)).payload);
    z.import(lift(bytesOf(storage("A", "put").at(-1) as string)).payload);
    const last = z.import(lift(bytesOf(storage("A", "put")[0] as string)).payload);
    expect(last.pending).toBeNull(); // every held record resolved
    expect(vvOf(z)).toEqual(manifest.merged.oplogVersion);
    const a = hostA();
    a.import(lift(bytesOf(storage("A", "put").at(-1) as string)).payload);
    const b = hostB();
    exchange(a, b);
    // Frontiers are a SET of op ids; Loro lists them in no promised order.
    const heads = (doc: LoroDoc) =>
      doc
        .oplogFrontiers()
        .map((id) => `${id.peer}@${id.counter}`)
        .sort();
    expect(heads(z)).toEqual(heads(a));
    expect(stateOf(z)).toEqual(stateOf(a));
  });
});

describe("DS-5 spike (c) — what ICE hands fieldd beside its checkpoints", () => {
  it("every journal record is a raw Loro update, byte-identical to what the store emitted", () => {
    for (const device of ["A", "B"] as const) {
      for (const file of storage(device, "append")) {
        expect(decodeImportBlobMeta(bytesOf(file), true).mode).toBe("update");
      }
      for (const entry of manifest.devices[device].tap.filter((t) => t.appendedAs !== null)) {
        expect(storage(device, "append")).toContain(entry.appendedAs);
      }
    }
  });

  it("a FOLDED edit lives only inside the checkpoint — it was emitted, never appended", () => {
    const folded = manifest.devices.A.tap.filter((t) => t.appendedAs === null);
    expect(folded.length).toBe(2); // the two edits flushed before the debounce fired
    const a = hostA(); // checkpoint 0 + every appended record: all fieldd holds today
    const heldBefore = a.oplogVersion();
    for (const entry of folded) {
      const end = decodeImportBlobMeta(bytesOf(entry.file as string), true).partialEndVersionVector;
      for (const [peer, counter] of end.toJSON()) {
        expect(heldBefore.get(peer) ?? 0).toBeLessThan(counter); // the journal never carried it
      }
    }
    a.import(lift(bytesOf(storage("A", "put").at(-1) as string)).payload);
    const afterCheckpoint = vvOf(a);
    for (const entry of folded) {
      a.import(bytesOf(entry.file as string)); // already inside the checkpoint
      expect(vvOf(a)).toEqual(afterCheckpoint);
    }
  });

  it("a live window is pushed the host's update from what it holds — ICE applies it, and re-journals it", () => {
    const push = bytesOf(manifest.livePush.file);
    const meta = decodeImportBlobMeta(push, true);
    expect(meta.mode).toBe("update");
    expect(manifest.livePush.quarantined).toBeNull(); // strata quarantines on any pending import
    expect(manifest.livePush.widgetsAfter).toBeGreaterThan(manifest.livePush.widgetsBefore);
    // ICE's autosave journals applied REMOTE updates too (subscribeRemote): a pushed
    // record comes straight back to fieldd as the window's own append. A Loro host
    // absorbs that as a no-op import; the opaque journal would have grown by it.
    expect(manifest.livePush.rejournaledAppends).toBe(1);
    expect(manifest.livePush.rejournaledIsPush).toBe(true);
  });
});

// ---- (d) DK-4: the frame across the pins ----
const GOLDEN = join(HERE, manifest.golden.dir);
const goldenBytes = (file: string): Uint8Array => new Uint8Array(readFileSync(join(GOLDEN, file)));
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
/** 0.11.0's own checkpoints as DS-5 committed them (`fixtures/`, 2026-09-30) — moved, never rewritten. */
const GOLDEN_0_11_0: Readonly<Record<string, string>> = {
  "a-checkpoint-0.ice1": "ab9e4646d8aaade98bfc2643a7e04eb0c0cc692a1fcfe741b47ab19f3d599738",
  "a-checkpoint-1.ice1": "903da54cfa3114c67d1d1056397854afbd734788f13744bbef49ea002969b89e",
  "b-checkpoint-0.ice1": "884ac8614a5eee996f6d2a54a5b0924fba071823c9c909ef1c68fcf357e177ed",
  "merged-roundtrip.ice1": "e7aaa4ad65ee0162d5a49df6140a322a7bfb5f3e6af7b34259fb0eef11e69c56",
};
const headerOf = (bytes: Uint8Array): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(lift(bytes).header)) as Record<string, unknown>;

describe("DS-5 spike (d) — DK-4: the frame is identical across the pins, and it carries the desk", () => {
  it("the pinned writer re-framed 0.11.0's own checkpoints byte for byte", () => {
    expect(manifest.golden.ice).toBe("0.11.0");
    expect(manifest.golden.files.map((row) => row.file)).toEqual(Object.keys(GOLDEN_0_11_0).sort());
    for (const row of manifest.golden.files) {
      // the golden is the very bytes 0.11.0 wrote…
      expect(sha256(goldenBytes(row.file)), row.file).toBe(GOLDEN_0_11_0[row.file]);
      expect(row.sha256).toBe(GOLDEN_0_11_0[row.file]);
      // …and the pinned ICE's `encodeEnvelope`, handed their header and payload, wrote them again
      expect(row.reframedSha256, row.file).toBe(row.sha256);
      expect(row.identical).toBe(true);
      expect(row.engineSchema).toBe(2);
    }
  });

  it("this rule reads both pins' frames alike: one magic, one version, the length-prefixed header", () => {
    const pins = [
      ...Object.keys(GOLDEN_0_11_0).map((file) => goldenBytes(file)),
      ...checkpoints.map((file) => bytesOf(file)),
    ];
    for (const bytes of pins) {
      expect([...bytes.subarray(0, 5)]).toEqual([0x49, 0x43, 0x45, 0x31, 1]);
      expect(Buffer.compare(Buffer.from(wrap(lift(bytes))), Buffer.from(bytes))).toBe(0);
    }
  });

  it("reads the desk's new types: the root `desk.desk`, the desk's packs, its notes in the snapshot", () => {
    expect(manifest.objectType).toBe("desk.note");
    for (const file of checkpoints) {
      const header = headerOf(bytesOf(file));
      expect(header["engineSchema"], file).toBe(3);
      expect(header["rootCanvas"]).toEqual({ id: "desk.desk", semanticVersion: 1 });
      expect(header["prefabVersions"]).toMatchObject({
        "desk.note": 1,
        "@ice/canvas/desk.desk": 1,
      });
    }
    for (const file of Object.keys(GOLDEN_0_11_0)) {
      const header = headerOf(goldenBytes(file));
      expect(header["engineSchema"]).toBe(2);
      expect(header["rootCanvas"]).toBeUndefined(); // the root identity came with schema 3
    }
    // the merged snapshot, read with loro-crdt alone: the entities' `comp:PrefabId` names the desk's note
    const merged = new LoroDoc();
    merged.import(lift(bytesOf(manifest.merged.file)).payload);
    const json = merged.toJSON() as {
      entities: Record<string, { "comp:PrefabId"?: { id: string } }>;
      meta: Record<string, unknown>;
    };
    const notes = Object.values(json.entities).filter(
      (entity) => entity["comp:PrefabId"]?.id === manifest.objectType,
    );
    expect(notes).toHaveLength(manifest.merged.iceOpenedWidgets);
    expect(json.meta["ice:rootCanvas"]).toBe(
      JSON.stringify({ id: "desk.desk", semanticVersion: 1 }),
    );
  });
});
