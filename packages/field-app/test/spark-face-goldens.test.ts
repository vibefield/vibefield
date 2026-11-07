// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// DESIGN.md §2.10 — every face golden is fresh (IOS-12f's f5g, VF-PM 2026-11-07). The rows, hatch, stills and frames
// goldens each record the sha256 of the files they were made from: the vendored engines, hatch.tsx, the rows golden
// under a picture set, and each PNG. Their scripts' `--check` holds those pins, but nothing in `pnpm verify` ran them.
// Until this file their freshness was by convention, and nothing anywhere pinned hatch.tsx. Here each pin is held
// against its file, GPU-free, so an edit to an engine, to hatch.tsx, to a rows golden or to a PNG is red until the
// golden is made again on purpose by its script (never by hand), and the phone's copy with it.
//
// The DNA and flat-star goldens have no row: they pin no sha256, and spark-face.test.tsx recomputes both against the
// engine and flat-star.ts in every verify. It also pins the two vendored engines to James's files.

const KIT = join(dirname(fileURLToPath(import.meta.url)), "../../design-kit");

type Pin = { file: string; sha256: string };
type Picture = Pin & { id: string; bytes?: number };

const read = <T>(file: string): T => JSON.parse(readFileSync(join(KIT, file), "utf8")) as T;
const sha256 = (file: string): string =>
  createHash("sha256")
    .update(readFileSync(join(KIT, file)))
    .digest("hex");

/** A pin holds when its file's sha256 is the one the golden recorded. */
function expectPinned(pin: Pin, said: string): void {
  expect(sha256(pin.file), `${said}: ${pin.file}`).toBe(pin.sha256);
}

const FACE_ENGINE = "src/spark-face/vendor/sparks.js";
const STAR_ENGINE = "src/spark-face/vendor/star-spark.js";
const HATCH = "src/spark-face/hatch.tsx";

describe("DESIGN.md §2.10 — the face goldens are made from the files they name (IOS-12f's f5g)", () => {
  it("the rows golden pins the face engine it was dealt from", () => {
    const golden = read<{ engine: Pin }>("fixtures/spark-rows.golden.json");
    expect(golden.engine.file).toBe(FACE_ENGINE);
    expectPinned(golden.engine, "the rows golden's engine");
  });

  it("the hatch golden pins the star engine, the face engine and hatch.tsx it was dealt from", () => {
    const golden = read<{ engines: { star: Pin; face: Pin; hatch: Pin } }>(
      "fixtures/spark-hatch.golden.json",
    );
    expect([golden.engines.star.file, golden.engines.face.file, golden.engines.hatch.file]).toEqual(
      [STAR_ENGINE, FACE_ENGINE, HATCH],
    );
    expectPinned(golden.engines.star, "the hatch golden's star engine");
    expectPinned(golden.engines.face, "the hatch golden's face engine");
    expectPinned(golden.engines.hatch, "the hatch golden's hatch");
  });

  it("the stills' manifest pins the face engine, the rows golden, and each of its 58 PNGs", () => {
    const manifest = read<{ engine: Pin; rows: Pin; cases: Picture[] }>(
      "fixtures/spark-stills.manifest.json",
    );
    expect(manifest.engine.file).toBe(FACE_ENGINE);
    expect(manifest.rows.file).toBe("fixtures/spark-rows.golden.json");
    expectPinned(manifest.engine, "the stills' engine");
    expectPinned(manifest.rows, "the stills' rows golden");
    expect(manifest.cases).toHaveLength(58);
    for (const still of manifest.cases) expectPinned(still, `the still ${still.id}`);
  });

  it("the frames' manifest pins the star engine, the hatch golden, and each of its 19 PNGs, their bytes and the sum", () => {
    const manifest = read<{ engine: Pin; rows: Pin; bytes: number; cases: Picture[] }>(
      "fixtures/spark-hatch-frames.manifest.json",
    );
    expect(manifest.engine.file).toBe(STAR_ENGINE);
    expect(manifest.rows.file).toBe("fixtures/spark-hatch.golden.json");
    expectPinned(manifest.engine, "the frames' engine");
    expectPinned(manifest.rows, "the frames' hatch golden");
    expect(manifest.cases).toHaveLength(19);
    let sum = 0;
    for (const frame of manifest.cases) {
      expectPinned(frame, `the frame ${frame.id}`);
      const bytes = readFileSync(join(KIT, frame.file)).length;
      expect(bytes, `the frame ${frame.id}'s bytes`).toBe(frame.bytes);
      sum += bytes;
    }
    expect(sum, "the frames' bytes").toBe(manifest.bytes);
  });
});
