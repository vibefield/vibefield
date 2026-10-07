// @vitest-environment happy-dom
/**
 * DK-15 — THE STILL UNDER THE COVERS (DESIGN.md §8 "The covers over the desk"; DK-D25 — "frozen desk should be still and
 * consume no render time at all, do it properly"; R16). The controller over fake seams: the RULED ORDER — the cover over
 * the live desk while the capture runs, the still blurred ONCE by 40 CSS px × its px per CSS px, swapped in, the canvas
 * hidden by `visibility`, and only then `freeze("cover")`, the park seen; back to Canvas THAW FIRST, the canvas shown at
 * once, the still dropped; a resize or a theme change re-captures (thaw → one frame → capture → freeze); a capture that
 * answers nothing covers the mat's ground and, on a desk that had drawn, says "The desk lost its graphics device" ONCE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blurStill,
  COVER,
  type CoverDesk,
  type CoverSeams,
  coverCaptures,
  coverRecords,
  createCoverStill,
  LOST_DEVICE_NOTICE,
  LOST_DEVICE_WORDS,
  resetCoverRecordsForTest,
  type StillFace,
  stillCanvasSurface,
} from "../src/field/desk/cover-still";

beforeEach(() => resetCoverRecordsForTest());
afterEach(() => vi.restoreAllMocks());

/** A still as the capture door hands it: its size, and whether it was closed. */
function bitmap(width: number, height: number) {
  const b = { width, height, closed: false, close: () => (b.closed = true) };
  return b as unknown as ImageBitmap & { closed: boolean };
}

/** Settle every pending microtask (the controller awaits the capture and each page frame). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** The world the controller runs in, every seam a recorder; `log` holds the order of everything it did. */
function harness(opts: { frames?: number; viewWidth?: number; answer?: "still" | "nothing" } = {}) {
  const log: string[] = [];
  let t = 1000;
  const gate = { holds: 0, parked: false, freezes: 0, thaws: 0 };
  const canvas = document.createElement("canvas");
  const perf = { frames: opts.frames ?? 120 };
  let pending: ((b: ImageBitmap | undefined) => void) | null = null;
  const captured: (ImageBitmap & { closed: boolean })[] = [];
  const desk: CoverDesk = {
    handle: {
      capture: () =>
        new Promise<ImageBitmap | undefined>((resolve) => {
          log.push("capture");
          pending = resolve;
        }),
      canvas,
      perf: () => ({ frames: perf.frames }) as ReturnType<CoverDesk["handle"]["perf"]>,
    },
  };
  let mounted: CoverDesk | null = desk;
  const faces: StillFace["kind"][] = [];
  const said: { id: string; text: string }[] = [];
  const blurred: number[] = [];
  const seams: CoverSeams = {
    frame: () => ({
      freeze: () => {
        log.push(`freeze(canvas ${canvas.style.visibility || "shown"})`);
        gate.holds += 1;
        gate.freezes += 1;
        let done = false;
        return () => {
          if (done) return;
          done = true;
          gate.holds -= 1;
          gate.thaws += 1;
          gate.parked = false;
          log.push("thaw");
        };
      },
      isParked: () => gate.parked,
    }),
    desk: () => mounted,
    surface: {
      show: (face) => {
        faces.push(face.kind);
        log.push(`show ${face.kind}`);
      },
    },
    blur: (source, px) => {
      blurred.push(px);
      log.push(`blur ${px}`);
      return bitmap(source.width, source.height);
    },
    viewWidth: () => opts.viewWidth ?? 1180,
    say: (id, text) => said.push({ id, text }),
    now: () => (t += 1),
    nextFrame: () => Promise.resolve(),
    reduced: () => false,
  };
  const still = createCoverStill(seams);
  return {
    still,
    log,
    gate,
    canvas,
    perf,
    faces,
    said,
    blurred,
    captured,
    /** The capture door answers: a still of the view at DPR 2, or nothing (a lost device). */
    answer(
      kind: "still" | "nothing" = opts.answer ?? "still",
      width = 2 * (opts.viewWidth ?? 1180),
    ) {
      const resolve = pending;
      pending = null;
      if (resolve === null) throw new Error("no capture asked");
      if (kind === "nothing") resolve(undefined);
      else {
        const b = bitmap(width, 1496);
        captured.push(b);
        resolve(b);
      }
    },
    asked: () => pending !== null,
    unmount() {
      mounted = null;
    },
    park() {
      gate.parked = true;
    },
  };
}

describe("THE RISE — the cover over the live desk, then capture → blur once → swap → hide → freeze", () => {
  it("asks the capture first and freezes nothing, hides nothing, shows nothing until it answers — the live desk under the fade", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    expect(h.asked()).toBe(true);
    expect(h.gate.freezes).toBe(0);
    expect(h.canvas.style.visibility).toBe("");
    expect(h.faces).toEqual([]);
  });

  it("blurs ONCE by 40 CSS px × the still's px per CSS px, swaps it in, hides the canvas by visibility, THEN freezes", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    expect(h.blurred).toEqual([80]); // a 2360-px still of a 1180-px view: 2 px per CSS px
    expect(h.log).toEqual(["capture", "blur 80", "show still", "freeze(canvas hidden)"]);
    expect(h.canvas.style.visibility).toBe("hidden");
    expect(h.canvas.style.display).toBe("");
    expect(h.captured[0]?.closed).toBe(true); // the door's still closed once blurred
    const rec = coverRecords().at(-1);
    expect(rec?.view).toBe("godview");
    expect(rec?.steps).toEqual(["capture", "blur", "swap", "hide", "freeze"]);
    expect(rec?.passes[0]?.capture).toMatchObject({ width: 2360, viewWidth: 1180, pxPerCss: 2 });
    expect(rec?.passes[0]?.blur?.px).toBe(80);
  });

  it("the blur scales with the view's DPR: 40 at DPR 1, 120 at DPR 3", async () => {
    const one = harness({ viewWidth: 1180 });
    one.still.cover(true, "history");
    await flush();
    one.answer("still", 1180); // a DPR-1 still: 1180 px of a 1180-px view
    await flush();
    expect(one.blurred).toEqual([COVER.blurCssPx]);
    const three = harness({ viewWidth: 1180 });
    three.still.cover(true, "history");
    await flush();
    three.answer("still", 3540);
    await flush();
    expect(three.blurred).toEqual([120]);
    expect(coverRecords().at(-1)?.passes[0]?.capture?.pxPerCss).toBe(3);
  });

  it("records the PARK when the gate parks — after the freeze, the last step of the rise", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    expect(coverRecords().at(-1)?.passes[0]?.parked).toBeUndefined();
    h.park();
    await flush();
    const rec = coverRecords().at(-1);
    expect(rec?.steps.at(-1)).toBe("park");
    expect(rec?.passes[0]?.parked).toBeGreaterThan(
      rec?.passes[0]?.frozen ?? Number.POSITIVE_INFINITY,
    );
  });

  it("between covered views nothing is taken again: one stand, one freeze", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    h.still.cover(true, "history"); // Godview → History: the cover stays up
    await flush();
    expect(h.asked()).toBe(false);
    expect(h.gate.freezes).toBe(1);
    expect(coverRecords()).toHaveLength(1);
  });
});

describe("THE LOWERING — thaw first, the live canvas shown at once, the still dropped", () => {
  it("in that order, in one go", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    h.log.length = 0;
    h.still.cover(false);
    expect(h.log).toEqual(["thaw", "show none"]);
    expect(h.canvas.style.visibility).toBe("");
    expect(h.gate.holds).toBe(0);
    const rec = coverRecords().at(-1);
    expect(rec?.steps.slice(-3)).toEqual(["thaw", "show", "drop"]);
    expect(rec?.thawed).toBeLessThan(rec?.shown ?? 0);
    expect(rec?.shown).toBeLessThan(rec?.dropped ?? 0);
  });

  it("a cover lowered before its capture answered shows nothing and freezes nothing — the late still is closed", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.still.cover(false);
    h.answer();
    await flush();
    expect(h.gate.freezes).toBe(0);
    expect(h.faces).toEqual(["none"]);
    expect(h.captured[0]?.closed).toBe(true);
    expect(coverRecords().at(-1)?.passes[0]?.aborted).toBe(true);
  });

  it("unmounted under a cover, it thaws and shows the canvas — a crashed frame cannot wedge the engine", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    h.still.dispose();
    expect(h.gate.holds).toBe(0);
    expect(h.canvas.style.visibility).toBe("");
  });
});

describe("AGAIN — a resize or a theme change while covered: thaw → one frame → capture → freeze", () => {
  it("takes the still again after the thawed desk presented one frame", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    h.park();
    await flush();
    h.log.length = 0;
    h.still.recapture("theme");
    await flush();
    expect(h.log).toEqual(["thaw"]); // waiting for its one frame — no capture yet
    expect(h.asked()).toBe(false);
    h.perf.frames += 1; // the thawed desk presents
    await flush();
    expect(h.asked()).toBe(true);
    h.answer();
    await flush();
    expect(h.log).toEqual(["thaw", "capture", "blur 80", "show still", "freeze(canvas hidden)"]);
    const rec = coverRecords().at(-1);
    expect(rec?.passes.map((p) => p.reason)).toEqual(["rise", "theme"]);
    expect(rec?.passes[1]?.frame?.frames).toBe(1);
    expect(rec?.steps).toEqual([
      ...["capture", "blur", "swap", "hide", "freeze", "park"],
      ...["thaw", "frame", "capture", "blur", "swap", "hide", "freeze"],
    ]);
  });

  it("asked while the rise's capture is in flight, it runs once that one has swapped — never two captures at once", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.still.recapture("resize");
    await flush();
    h.answer();
    await flush();
    // the rise swapped and froze; the resize's pass thawed and waits for its frame
    expect(h.log).toEqual(["capture", "blur 80", "show still", "freeze(canvas hidden)", "thaw"]);
    h.perf.frames += 1;
    await flush();
    h.answer();
    await flush();
    expect(
      coverRecords()
        .at(-1)
        ?.passes.map((p) => p.reason),
    ).toEqual(["rise", "resize"]);
    expect(h.gate.holds).toBe(1);
  });

  it("on the canvas nothing is taken: a resize or a theme change with no cover asks nothing", async () => {
    const h = harness();
    h.still.recapture("theme");
    h.still.recapture("resize");
    await flush();
    expect(h.asked()).toBe(false);
    expect(h.log).toEqual([]);
  });

  it("a thawed desk that presents nothing in the wait is captured as it last showed", async () => {
    {
      const h = harness();
      let now = 0;
      const still = createCoverStill({
        frame: () => ({ freeze: () => () => undefined, isParked: () => false }),
        desk: () => ({
          handle: {
            capture: async () => bitmap(2360, 1496),
            canvas: h.canvas,
            perf: () => ({ frames: 5 }) as ReturnType<CoverDesk["handle"]["perf"]>,
          },
        }),
        surface: { show: () => undefined },
        blur: (b) => b,
        viewWidth: () => 1180,
        say: () => undefined,
        now: () => (now += 100),
        nextFrame: () => Promise.resolve(),
        reduced: () => false,
      });
      still.cover(true, "godview");
      await flush();
      still.recapture("theme");
      await flush();
      const pass = coverRecords().at(-1)?.passes[1];
      expect(pass?.frame?.frames).toBe(0);
      expect(pass?.capture?.width).toBe(2360);
    }
  });
});

describe("NOTHING — a capture that answers nothing covers the mat's ground", () => {
  it("on a desk that had drawn: the ground, and the status line says so ONCE a stand", async () => {
    const h = harness();
    h.still.cover(true, "history");
    await flush();
    h.answer("nothing");
    await flush();
    expect(h.faces).toEqual(["ground"]);
    expect(h.canvas.style.visibility).toBe("hidden");
    expect(h.gate.holds).toBe(1); // still zero frames
    expect(h.said).toEqual([{ id: LOST_DEVICE_NOTICE, text: LOST_DEVICE_WORDS }]);
    // a theme change takes it again — nothing again — and nothing more is said
    h.still.recapture("theme");
    h.perf.frames += 1;
    await flush();
    h.answer("nothing");
    await flush();
    expect(h.said).toHaveLength(1);
    expect(coverRecords().at(-1)?.said).toBe("The desk lost its graphics device");
  });

  it("on a desk that never drew: the ground, and nothing said (its card says why on the canvas)", async () => {
    const h = harness({ frames: 0 });
    h.still.cover(true, "godview");
    await flush();
    h.answer("nothing");
    await flush();
    expect(h.faces).toEqual(["ground"]);
    expect(h.said).toEqual([]);
  });

  it("no desk mounted: the ground at once, and the engine frozen — zero frames all the same", async () => {
    const h = harness();
    h.unmount();
    h.still.cover(true, "godview");
    expect(h.faces).toEqual(["ground"]);
    expect(h.gate.holds).toBe(1);
    expect(h.said).toEqual([]);
  });

  it("the witnesses' switch: `coverCaptures(\"nothing\")` answers nothing for the cover's own capture", async () => {
    const h = harness();
    expect(coverCaptures()).toBe("desk");
    coverCaptures("nothing");
    h.still.cover(true, "godview");
    await flush();
    expect(h.asked()).toBe(false); // the door never asked
    expect(h.faces).toEqual(["ground"]);
    expect(h.said).toHaveLength(1);
  });
});

describe("the engine under a standing cover, and the record", () => {
  it("a new engine is frozen at once and the old one thawed — the still stands", async () => {
    const h = harness();
    h.still.cover(true, "godview");
    await flush();
    h.answer();
    await flush();
    h.still.engineChanged();
    expect(h.gate.freezes).toBe(2);
    expect(h.gate.holds).toBe(1);
    expect(h.faces).toEqual(["still"]);
  });

  it("keeps the last eight stands", async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) {
      h.still.cover(true, i % 2 === 0 ? "godview" : "history");
      await flush();
      h.answer();
      await flush();
      h.still.cover(false);
    }
    expect(coverRecords()).toHaveLength(8);
    expect(coverRecords().at(-1)?.seq).toBe(10);
  });
});

describe("blurStill — once, in an OffscreenCanvas filter, the edges clamped", () => {
  it("pads by the kernel's reach, stretches the edges nearest-sampled, and draws the blur back at the still's size", () => {
    const calls: { canvas: number; op: string; args: unknown[] }[] = [];
    const made: { width: number; height: number }[] = [];
    const make = (width: number, height: number) => {
      const index = made.length;
      made.push({ width, height });
      const ctx = {
        imageSmoothingEnabled: true,
        filter: "none",
        drawImage: (...args: unknown[]) =>
          calls.push({
            canvas: index,
            op: `drawImage smooth=${ctx.imageSmoothingEnabled} filter=${ctx.filter}`,
            args,
          }),
      };
      return {
        width,
        height,
        getContext: () => ctx,
        transferToImageBitmap: () => ({ width, height, from: index }),
      } as unknown as OffscreenCanvas;
    };
    const source = bitmap(200, 100);
    const out = blurStill(source, 80, make) as unknown as { width: number; height: number };
    expect(made).toEqual([
      { width: 200 + 2 * 240, height: 100 + 2 * 240 },
      { width: 200, height: 100 },
    ]);
    const padded = calls.filter((c) => c.canvas === 0);
    expect(padded).toHaveLength(9); // the still, four edges, four corners
    expect(padded.every((c) => c.op === "drawImage smooth=false filter=none")).toBe(true);
    expect(padded[1]?.args).toEqual([source, 0, 0, 200, 1, 240, 0, 200, 240]); // the top row stretched up
    const final = calls.filter((c) => c.canvas === 1);
    expect(final).toEqual([
      {
        canvas: 1,
        op: "drawImage smooth=true filter=blur(80px)",
        args: [expect.anything(), -240, -240],
      },
    ]);
    expect(out).toMatchObject({ width: 200, height: 100 });
  });
});

describe("stillCanvasSurface — the still handed over whole, the recede started once", () => {
  function element() {
    const el = document.createElement("canvas");
    const transfers: (ImageBitmap | null)[] = [];
    vi.spyOn(el, "getContext").mockImplementation(
      // the bitmaprenderer context, as much of it as the surface uses
      () =>
        ({
          transferFromImageBitmap: (b: ImageBitmap | null) => transfers.push(b),
        }) as never,
    );
    return { el, transfers };
  }

  it("a still: transferred, shown, and set receding; taken again it keeps the recede where it is", () => {
    const { el, transfers } = element();
    const surface = stillCanvasSurface(el);
    const first = bitmap(10, 10);
    surface.show({ kind: "still", bitmap: first });
    expect(transfers).toEqual([first]);
    expect(el.dataset.still).toBe("still");
    expect(el.dataset.recede).toBe("true");
    el.dataset.recede = "true";
    surface.show({ kind: "still", bitmap: bitmap(10, 10) });
    expect(el.dataset.recede).toBe("true");
  });

  it("the ground and nothing: the bitmap let go, no recede", () => {
    const { el, transfers } = element();
    const surface = stillCanvasSurface(el);
    surface.show({ kind: "still", bitmap: bitmap(10, 10) });
    surface.show({ kind: "ground" });
    expect(el.dataset.still).toBe("ground");
    expect(el.dataset.recede).toBe("false");
    surface.show({ kind: "none" });
    expect(el.dataset.still).toBe("none");
    expect(transfers.at(-1)).toBeNull();
  });
});
