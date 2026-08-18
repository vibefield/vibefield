/**
 * R3-0 S1 — auto-size measurement wiring (ICE design-004 §2, the host pipeline).
 *
 * ICE installs `measureIngest` ONLY when `createCanvasEngine` is handed a
 * `measureQueue`, and the ResizeObserver that FILLS that queue lives on the
 * canvas component's `measureQueue` prop. Handing the two halves different
 * instances is not an error anywhere: the observer fills one, ingest drains the
 * other, and nothing ever measures — auto-size stays a dead declaration. These
 * tests hold the pairing from both ends: the engine really ingests from the
 * queue `measureQueueFor` hands out, and CanvasStage really passes that one.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvasEngine,
  defineQuery,
  type Entity,
  MeasuredSize,
  Position,
  PrefabId,
  Viewport,
} from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine, measureQueueFor, seedField } from "../src/field-engine";

const idQ = defineQuery([Position, PrefabId]);

/** The seeded board, driven headless — the drop-consume.test.ts idiom. */
function makeEngine() {
  const registry = buildRegistry();
  const ce = createFieldEngine(registry);
  seedField(ce, ce.docs.create(), registry);
  ce.world.setResource(Viewport, { w: 1900, h: 1100, dpr: 1 });
  return ce;
}

function stepper(ce: ReturnType<typeof makeEngine>) {
  let now = 0;
  return (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
}

function findByType(world: ReturnType<typeof makeEngine>["world"], type: string): Entity[] {
  const out: Entity[] = [];
  world.query(idQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (world.get(e, PrefabId)?.id === type) out.push(e);
    }
  });
  return out;
}

describe("field engine measure queue pairing", () => {
  it("pairs one stable queue with every engine it builds", () => {
    const a = createFieldEngine(buildRegistry());
    const b = createFieldEngine(buildRegistry());

    const queueA = measureQueueFor(a);
    expect(queueA).toBeDefined();
    // Stable for the engine's lifetime — CanvasStage passes this straight into a
    // prop whose identity change would re-boot the canvas mount.
    expect(measureQueueFor(a)).toBe(queueA);
    // Per-engine, never a shared module singleton: one board's resize samples
    // must not fold into another board's entities.
    expect(measureQueueFor(b)).not.toBe(queueA);
  });

  it("leaves an engine built outside createFieldEngine unpaired", () => {
    // ICE's documented absent case — measurement is simply skipped, and the
    // side table says so rather than handing out someone else's queue.
    expect(measureQueueFor(createCanvasEngine({}))).toBeUndefined();
  });
});

describe("field engine measurement ingest", () => {
  it("ingests from the queue measureQueueFor hands out", () => {
    const ce = makeEngine();
    const step = stepper(ce);
    step(3); // index warm-up

    const clock = findByType(ce.world, "vibefield.widgetlab.clock")[0] as Entity;
    expect(clock).toBeDefined();
    expect(ce.world.get(clock, MeasuredSize)).toBeUndefined();

    const queue = measureQueueFor(ce);
    expect(queue).toBeDefined();
    queue?.enqueue({ entity: clock, w: 320, h: 214 });
    expect(queue?.size()).toBe(1);

    step();

    // Drained BY THIS ENGINE (queue emptied) and folded into the rider — the two
    // halves of the proof that the installed ingest system reads this instance.
    expect(queue?.size()).toBe(0);
    expect(ce.world.get(clock, MeasuredSize)).toEqual({ w: 320, h: 214 });
  });

  it("keeps ingesting on later ticks, past ICE's ±1px dead band", () => {
    const ce = makeEngine();
    const step = stepper(ce);
    step(3);

    const clock = findByType(ce.world, "vibefield.widgetlab.clock")[0] as Entity;
    const queue = measureQueueFor(ce);

    queue?.enqueue({ entity: clock, w: 320, h: 214 });
    step();
    expect(ce.world.get(clock, MeasuredSize)).toEqual({ w: 320, h: 214 });

    // Sub-pixel RO jitter must not restamp (it would churn breakpoint/cull).
    queue?.enqueue({ entity: clock, w: 320.5, h: 214.5 });
    step();
    expect(ce.world.get(clock, MeasuredSize)).toEqual({ w: 320, h: 214 });

    // A real resize does — the wiring stays live across frames, not one-shot.
    queue?.enqueue({ entity: clock, w: 480, h: 300 });
    step();
    expect(ce.world.get(clock, MeasuredSize)).toEqual({ w: 480, h: 300 });
  });
});

describe("canvas stage measure queue prop", () => {
  it("passes the engine's own queue to the canvas", () => {
    // Structural, not behavioral: CanvasStage mounts R3F + three + the WebGPU
    // ground layer, so the ResizeObserver half cannot be driven headless. What
    // matters is only that the component reads the pairing rather than minting
    // a second queue — which is exactly what the source says.
    const stage = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "field", "CanvasStage.tsx"),
      "utf8",
    );
    // The prop is SPREAD (ICE declares it absent-or-present, and the repo runs
    // exactOptionalPropertyTypes), so assert the pairing read and the spread
    // that carries it rather than a literal attribute.
    expect(stage).toMatch(/const measure = measureQueueFor\(ce\);/);
    expect(stage).toMatch(/measure === undefined \? \{\} : \{ measureQueue: measure \}/);
    expect(stage).toMatch(/<InfiniteCanvasGround[\s\S]*?\{\.\.\.measureProp\}/);
    // Never a second queue minted here — that is the failure the pairing exists
    // to prevent (observer fills one instance, ingest drains the other).
    expect(stage).not.toMatch(/createMeasureQueue/);
  });
});
