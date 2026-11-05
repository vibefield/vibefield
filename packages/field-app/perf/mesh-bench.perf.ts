import { describe, expect, it } from "vitest";
import { prepareMeshCorpus, streamPass } from "./lib/mesh-bench";
import { withVirtualTime } from "./lib/virtual-time";

// THE MESH BENCH'S OWN WINDOWS (PG-9 S5a; VF-PM 11:42Z). Two properties a device run's expected numbers stand on.
//   · IDLE hears the ledger's step whatever the corpus's span. Puppeteer's usage ledger re-emits every priced row on
//     its series' `stepMs` boundaries (PU-I). A 30 s window from the corpus's end missed that step by a millisecond
//     whenever the span was a multiple of 30 s, so the 300 s corpora read idle 0.
//   · The phone's bytes are TALLIED BY DESKTOP, and the desktops sum to the whole. The bench plays two desktops, but
//     fieldd's replay (FIELDD_DEBUG_SWARM_CORPUS) plays this desktop's half alone.
// Outside `pnpm test` and `pnpm verify` (`vitest.perf.config.ts`):
//   ./node_modules/.bin/vitest run --config vitest.perf.config.ts perf/mesh-bench.perf.ts

const pass = (durationMs: number) => {
  const prepared = prepareMeshCorpus({ n: 5, durationMs, seed: 1, foldTickMs: 250 });
  return withVirtualTime(prepared.baseWall, async (time) => ({
    name: prepared.name,
    devices: [prepared.here.id, prepared.peer.id],
    result: await streamPass(prepared, time),
  }));
};

describe("the mesh bench's own windows (PG-9 S5a)", () => {
  it("hears the ledger's step in idle whatever the corpus's span (8 s, and 60 s on a step boundary)", async () => {
    for (const durationMs of [8_000, 60_000]) {
      const { name, result } = await pass(durationMs);
      const at = result.idleAttribution;
      expect(result.idle.frames, `${name}: idle hears a frame`).toBeGreaterThan(0);
      expect(at.costOnly + at.costAndRecency, `${name}: idle hears the cost step`).toBeGreaterThan(
        0,
      );
    }
  });

  it("tallies the phone's bytes by desktop, and the desktops sum to the whole", async () => {
    const { name, devices, result } = await pass(8_000);
    for (const [window, tally] of [
      ["busy", result.busy],
      ["idle", result.idle],
    ] as const) {
      const parts = Object.values(tally.byDevice);
      const sum = (key: "bytes" | "frames" | "upserts") =>
        parts.reduce((total, part) => total + part[key], 0);
      expect(sum("bytes"), `${name} ${window}: the desktops' bytes are the whole`).toBe(
        tally.bytes,
      );
      expect(sum("frames"), `${name} ${window}: the desktops' frames are the whole`).toBe(
        tally.frames,
      );
      expect(sum("upserts"), `${name} ${window}: the desktops' upserts are the whole`).toBe(
        tally.upserts,
      );
    }
    expect(Object.keys(result.busy.byDevice).sort(), `${name}: busy hears both desktops`).toEqual(
      [...devices].sort(),
    );
  });
});
