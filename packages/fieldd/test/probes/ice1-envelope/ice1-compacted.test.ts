// DS-5d — the ICE1 envelope of a COMPACTED canvas (design-06 §4; the wave-3
// ruling of 2026-10-01 12:30). `generate-compacted.mjs` wrote these fixtures
// through ICE 0.11.0 itself: a window made a canvas; the host's state was
// compacted to a Loro shallow snapshot and framed by the ICE1 rule under the
// window's newest checkpoint header; ICE OPENED it, kept editing, and saved.
// THIS file links loro-crdt and fieldd only — the Loro-level host's posture.
//
// *Correction at source (2026-10-01, DS-5d):* the spike's "the payload is a
// FULL Loro snapshot (never shallow)" (ice1-envelope.test.ts, the wave-1
// record's 23:30 entry) holds only for a canvas never compacted. loro-crdt
// 1.13.8 exports only a shallow snapshot from a doc that holds a shallow
// history; ICE opens one, and once its doc came from one, writes them too.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImportBlobMeta, LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService } from "../../../src/doc-service";
import { liftIce1, wrapIce1 } from "../../../src/ice1-envelope";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures-compacted");
const bytesOf = (file: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, file)));

interface Manifest {
  ice: string;
  loro: string;
  window1: { widgets: number; puts: number; appends: number };
  base: { file: string; payloadMode: string; fullSnapshotExportMode: string };
  iceOpened: { ok: boolean; widgets: number };
  window2: {
    widgets: number;
    checkpoint: { file: string; payloadMode: string };
    appends: string[];
  };
  hostTakesWhatIceWrote: Record<string, string>;
}
const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as Manifest;

const payloadOf = (envelope: Uint8Array): Uint8Array => {
  const lifted = liftIce1(envelope);
  if (!lifted.ok) throw new Error(`not liftable: ${lifted.reason}`);
  return lifted.payload;
};

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("DS-5d — a compacted canvas's ICE1 envelope", () => {
  it("is the fixed frame around a SHALLOW snapshot: it lifts, re-wraps byte for byte, and a fresh doc opens it", () => {
    const base = bytesOf(manifest.base.file);
    const lifted = liftIce1(base);
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(
      Buffer.compare(Buffer.from(wrapIce1(lifted.header, lifted.payload)), Buffer.from(base)),
    ).toBe(0);
    expect(decodeImportBlobMeta(lifted.payload, false).mode).toBe("shallow-snapshot");
    const doc = new LoroDoc();
    doc.import(lifted.payload);
    expect(doc.isShallow()).toBe(true);
    // A doc holding a shallow history exports nothing else — the reason the
    // spike's "FULL snapshot, never shallow" needed its correction.
    expect(decodeImportBlobMeta(doc.export({ mode: "snapshot" }), false).mode).toBe(
      "shallow-snapshot",
    );
    expect(manifest.base.fullSnapshotExportMode).toBe("shallow-snapshot");
  });

  it("ICE opened it whole and kept editing on it; what ICE wrote next is shallow too", () => {
    expect(manifest.ice).toMatch(/^0\.11\./);
    expect(manifest.loro).toBe("1.13.8");
    expect(manifest.iceOpened).toEqual({ ok: true, widgets: manifest.window1.widgets });
    expect(manifest.window2.widgets).toBeGreaterThan(manifest.iceOpened.widgets);
    const checkpoint = payloadOf(bytesOf(manifest.window2.checkpoint.file));
    expect(decodeImportBlobMeta(checkpoint, false).mode).toBe("shallow-snapshot");
    expect(manifest.window2.appends.length).toBeGreaterThan(0);
    for (const outcome of Object.values(manifest.hostTakesWhatIceWrote)) {
      expect(outcome).toBe("applied");
    }
  });

  it("fieldd keeps it all in Loro custody: the base is hosted, ICE's checkpoint folds, ICE's appends land", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-ice1-compacted-"));
    dirs.push(dataDir);
    const docs = new DocumentService({ dataDir, residency: false, compaction: false });
    const { docId } = await docs.create("board");
    const put = async (kind: "checkpoint" | "update", bytes: Uint8Array): Promise<void> => {
      await docs.writeDoc(docId, bytes, {
        revisionId: randomUUID(),
        kind,
        ...(kind === "update"
          ? { baseRevisionId: (await docs.readDocMeta(docId))?.revisionId ?? randomUUID() }
          : {}),
        engineSchema: 2,
        savedAt: Date.now(),
        byteLength: bytes.byteLength,
      });
    };
    await put("checkpoint", bytesOf(manifest.base.file));
    expect(await docs.hostVersion(docId)).toMatchObject({ hasCheckpoint: true });
    await put("checkpoint", bytesOf(manifest.window2.checkpoint.file));
    expect(await docs.hostVersion(docId)).toMatchObject({ hasCheckpoint: true });
    for (const file of manifest.window2.appends) await put("update", bytesOf(file));

    // What fieldd stores replays to exactly what ICE's window held.
    const expected = new LoroDoc();
    expected.import(payloadOf(bytesOf(manifest.base.file)));
    expected.import(payloadOf(bytesOf(manifest.window2.checkpoint.file)));
    for (const file of manifest.window2.appends) expected.import(bytesOf(file));
    const stored = await docs.readDoc(docId);
    const replayed = new LoroDoc();
    replayed.import(payloadOf(stored?.bytes as Uint8Array));
    for (const update of stored?.updates ?? []) replayed.import(update);
    expect(replayed.oplogVersion().compare(expected.oplogVersion())).toBe(0);
    docs.dispose();
  });
});
