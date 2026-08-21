// The standalone apply's correctness, over the REAL corpus.
//
// A microbench whose apply silently early-returns measures nothing, and the
// cheapest way for that to happen is a classification bug: one wrong comparison
// in `classify` turns every frame into "stale" and the numbers become the cost
// of an if-statement. These rows check the classifier's shape directly and then
// check that the corpus really does flow through the apply path.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyDecodedFrame, classify, decodeFrameBody, emptyReplica } from "../src/replica";
import { readCaptureFile } from "../src/trf1-container";

const CORPUS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/terminal-perf/trf1",
);

const frame = (over: Partial<Parameters<typeof classify>[1]> = {}) =>
  ({
    protocolVersion: 1,
    flags: 0,
    sessionHandle: 1n,
    viewHandle: 1n,
    sessionEpoch: 1n,
    layoutEpoch: 1n,
    frameSequence: 1n,
    terminalRevision: 1n,
    cols: 100,
    rows: 30,
    sections: [],
    ...over,
  }) as Parameters<typeof classify>[1];

describe("frame classification", () => {
  it("takes a full snapshot from any epoch that is not older", () => {
    const replica = emptyReplica();
    replica.sessionEpoch = 2n;
    replica.sequence = 10n;
    expect(classify(replica, frame({ flags: 1, sessionEpoch: 2n, frameSequence: 11n }))).toBe(
      "apply",
    );
    expect(classify(replica, frame({ flags: 1, sessionEpoch: 3n, frameSequence: 1n }))).toBe(
      "apply",
    );
  });

  it("calls an older epoch, and a sequence already seen, stale", () => {
    const replica = emptyReplica();
    replica.sessionEpoch = 2n;
    replica.sequence = 10n;
    expect(classify(replica, frame({ sessionEpoch: 1n, frameSequence: 99n }))).toBe("stale");
    expect(classify(replica, frame({ sessionEpoch: 2n, frameSequence: 10n }))).toBe("stale");
  });

  it("asks for a resync on a gap in an incremental stream", () => {
    const replica = emptyReplica();
    replica.sessionEpoch = 2n;
    replica.sequence = 10n;
    expect(classify(replica, frame({ sessionEpoch: 2n, frameSequence: 12n }))).toBe("resync");
    expect(classify(replica, frame({ sessionEpoch: 2n, frameSequence: 11n }))).toBe("apply");
  });

  it("stays in resync until a full frame clears it", () => {
    const replica = emptyReplica();
    replica.sessionEpoch = 2n;
    replica.sequence = 10n;
    replica.awaitingResync = true;
    expect(classify(replica, frame({ sessionEpoch: 2n, frameSequence: 11n }))).toBe("resync");
    expect(classify(replica, frame({ flags: 1, sessionEpoch: 2n, frameSequence: 11n }))).toBe(
      "apply",
    );
  });
});

describe("applying the recorded corpus", () => {
  const files = readdirSync(CORPUS).filter((file) => file.endsWith(".trf1"));

  it("has fixtures to apply", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`applies every frame of ${file} and builds a populated replica`, () => {
      const capture = readCaptureFile(join(CORPUS, file));
      const replica = emptyReplica();
      let applied = 0;
      let rows = 0;
      for (const record of capture.frames) {
        const outcome = applyDecodedFrame(replica, decodeFrameBody(record.bytes));
        // Zero stale and zero resync is a property of a corpus recorded from
        // ONE continuous subscription: a hole would mean the recorder dropped
        // packets, and the bench would then be timing the early-return path.
        expect(outcome.klass, `${file} frame ${applied}`).toBe("apply");
        applied += 1;
        rows += outcome.rowsApplied;
      }
      expect(applied).toBe(capture.frames.length);
      expect(rows, `${file} replaced no rows`).toBeGreaterThan(0);
      expect(replica.rows.length).toBe(capture.header.rows);
      expect(replica.cols).toBe(capture.header.cols);
      // A replica that decoded glyphs but never stored one would still pass the
      // row check; the catalog is what the geometry stage reads.
      expect(replica.glyphDefinitions.size, `${file} defined no glyphs`).toBeGreaterThan(0);
    });
  }
});
