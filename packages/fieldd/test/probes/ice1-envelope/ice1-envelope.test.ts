// DS-5 spike, 2026-09-30 — the ICE1 checkpoint envelope (thinking-desktop-sync-plane
// §5.1, DS-D18's "the spike that comes first"). Three questions, answered against
// REAL bytes: `generate.mjs` wrote every fixture through ICE 0.11.0's own autosave
// path (put = checkpoint, append = journal record), two devices, the §1.2 defect.
// THIS file links no ICE and no strata — only loro-crdt, the tree's one pinned
// resolution (EL8) — which is exactly the posture the Loro-level host must keep.
//
// (a) Can fieldd lift the Loro snapshot out of a checkpoint by a FIXED header rule?
// (b) Does a fresh LoroDoc import that snapshot plus the journal fieldd already
//     keeps, and converge with a doc that saw the same records in another order?
// (c) Does ICE hand raw Loro updates beside its checkpoints — and does a
//     checkpoint's FOLDED edit also go out as an update, or only inside it?
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
interface Manifest {
  ice: string;
  loro: string;
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

describe("DS-5 spike (a) — the Loro bytes lift out of an ICE1 checkpoint by a fixed rule", () => {
  it("probes real renderer-written checkpoints, with no ICE or strata linked here", () => {
    expect(manifest.ice).toBe("0.11.0");
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
