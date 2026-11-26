// C2 (2026-11-24), the window's half — A RUN'S PAGE MAIN CLOSES, on the REAL wire: desk-live over the window's real
// surface pool, over the real `LiveSurfaceRendererTransport` on in-memory ports (surfaces-pool.test.ts's idiom). Main
// tells the window a page it closed (the run's end, a rebind's close) by the `closed` summary on the page's attachment;
// the transport closes the attachment, the pool calls its lane lost, desk-live makes ONE probe mint, and only main's
// made-closed refusal takes the pane off the desk (or, under the hand, leaves it on the closed still, DESIGN.md §8
// "pages an agent's run opens"). desk-live-made.test.ts proves the same steps on the fixture's fake handles, where the
// loss is set by hand; this row proves the loss arrives as the wire carries it.
import {
  type LiveSurfaceRuntimeSummaryV1,
  SHELL_SURFACES_MADE_CLOSED,
  SHELL_SURFACES_SERVICE,
} from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import {
  type LiveSurfaceClosableFrame,
  type LiveSurfaceMessagePort,
  LiveSurfaceRendererTransport,
} from "@vibefield/live-surfaces/renderer";
import { afterEach, describe, expect, it } from "vitest";
import { forgetMadeForTest, type MadePaneGone } from "../src/surfaces/live/desk-live";
import { createSurfacePool } from "../src/surfaces/pool";
import { HELD, PAGE, SEEN, setup, UNSEEN } from "./desk-live-fixture";

const SURFACE_ID = "surface_0123456789abcdef";
const MADE = "surface_fedcba9876543210";
const RUN = "run-01J8Z3K9";
const GENERATION = 3;
const GRANT = {
  surfaceId: SURFACE_ID,
  ticket: { v: 1, token: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCDE" },
};

afterEach(() => forgetMadeForTest());

class MemoryPort implements LiveSurfaceMessagePort {
  onmessage: LiveSurfaceMessagePort["onmessage"] = null;
  onmessageerror: (() => void) | null = null;
  peer: MemoryPort | null = null;
  private readonly queued: unknown[] = [];
  private started = false;
  private closed = false;

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("memory port is closed");
    this.peer?.deliver(message);
  }

  start(): void {
    if (this.closed) return;
    this.started = true;
    for (const message of this.queued.splice(0)) this.onmessage?.({ data: message });
  }

  close(): void {
    this.closed = true;
    this.queued.length = 0;
  }

  private deliver(message: unknown): void {
    if (this.closed) return;
    if (!this.started) this.queued.push(message);
    else this.onmessage?.({ data: message });
  }
}

function channel(): [MemoryPort, MemoryPort] {
  const left = new MemoryPort();
  const right = new MemoryPort();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

function summary(
  state: LiveSurfaceRuntimeSummaryV1["state"],
  stateRevision: number,
): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId: SURFACE_ID,
    state,
    producerEpoch: 1,
    stateRevision,
    capabilities: {
      pointer: true,
      wheel: true,
      keyboard: true,
      textInput: true,
      touch: false,
      rotateDevice: false,
      resizeLogicalViewport: true,
      resizeBackingRaster: true,
      crop: false,
    },
    transport: "shared-texture",
  };
}

/** Main on the far end of the two ports: every attach granted live; `close` posts the closed summary. */
async function mainOverPorts() {
  const [rendererControl, hostControl] = channel();
  const [rendererFrames, hostFrames] = channel();
  hostControl.start();
  hostFrames.start();
  const transport = new LiveSurfaceRendererTransport<LiveSurfaceClosableFrame>(
    { v: 1, rendererGeneration: GENERATION },
    rendererControl,
    rendererFrames,
  );
  const attachments: string[] = [];
  hostControl.onmessage = (event) => {
    const message = event.data as { type?: string; requestId?: string };
    if (message.type !== "attach" || message.requestId === undefined) return;
    const attachmentId = `attachment_00000000000${attachments.length + 1}`;
    attachments.push(attachmentId);
    hostControl.postMessage({
      v: 1,
      type: "attached",
      requestId: message.requestId,
      attachment: { v: 1, attachmentId, summary: summary("live", 1) },
    });
  };
  hostControl.postMessage({
    v: 1,
    type: "ready",
    bootstrap: { v: 1, rendererGeneration: GENERATION },
  });
  await transport.ready;
  return {
    transport,
    attachments,
    /** Main closed the page: the closed summary on its attachment (custody's dispose publishes it). */
    close(attachmentId: string): void {
      hostControl.postMessage({
        v: 1,
        type: "summary",
        attachmentId,
        summary: summary("closed", 2),
      });
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A desk on the real pool: pane "a" names RUN; each surface.open answered by the next of `answers`, else granted. */
async function wiredDesk() {
  const main = await mainOverPorts();
  const pool = createSurfacePool<LiveSurfaceClosableFrame>({ transport: main.transport });
  const requests: Record<string, unknown>[] = [];
  const answers: (() => unknown)[] = [];
  const left: [string, MadePaneGone][] = [];
  const t = setup({
    pool: () => pool as never,
    runOf: (key) => (key === "a" ? { is: "run", run: RUN } : { is: "none" }),
    leave: (key, why) => {
      left.push([key, why]);
    },
    mintClient: () => ({
      async request(method: string, params?: unknown) {
        if (method !== "surface.open") return {};
        requests.push(params as Record<string, unknown>);
        const next = answers.shift();
        return next === undefined ? GRANT : next();
      },
    }),
  });
  return { ...t, main, pool, requests, answers, left };
}

const closedForGood = (): FielddRpcError =>
  new FielddRpcError("PRECONDITION_FAILED", "the desktop operation failed", false, {
    service: SHELL_SURFACES_SERVICE,
    state: SHELL_SURFACES_MADE_CLOSED,
  });

describe("C2 (2026-11-24), the window's half: a run's page main closes reaches the pane on the real wire", () => {
  it("adopted and seen, then closed by main: the closed summary loses the lane, ONE probe asks, and the pane leaves", async () => {
    const d = await wiredDesk();
    d.live.adoptMade("a", MADE);
    const face = d.live.open("a", PAGE, () => {});
    face.demand(SEEN);
    await settle();
    // the first mint adopted the made page, and the lane is live on main's attachment
    expect(d.requests).toHaveLength(1);
    expect(d.requests[0]).toMatchObject({ reuseKey: "a", made: MADE });
    expect(d.main.attachments).toHaveLength(1);
    expect(face.state()).not.toMatchObject({ is: "failed" });
    // main closes the run's page: its probe is refused as closed for good
    d.answers.push(() => {
      throw closedForGood();
    });
    d.main.close(d.main.attachments[0] ?? "");
    await settle();
    expect(d.requests).toHaveLength(2);
    expect(d.requests[1]).not.toHaveProperty("made");
    expect(d.left).toEqual([["a", "closed"]]);
    expect(face.state()).toEqual({ is: "failed", reason: "run-ended" });
    // gone for good: nothing more is asked of main
    await settle();
    expect(d.requests).toHaveLength(2);
    d.pool.dispose();
  });

  it("in the person's hand when main closes it: the closed still, and it stays when put down", async () => {
    const d = await wiredDesk();
    const face = d.live.open("a", PAGE, () => {});
    face.demand(HELD);
    await settle();
    expect(d.requests).toHaveLength(1);
    d.answers.push(() => {
      throw closedForGood();
    });
    d.main.close(d.main.attachments[0] ?? "");
    await settle();
    expect(d.left).toEqual([]);
    expect(face.state()).toEqual({ is: "failed", reason: "run-ended" });
    face.demand(UNSEEN);
    expect(d.left).toEqual([]);
    d.pool.dispose();
  });
});

// A run's pane after its run (2026-11-24) — the same word at a mount's FIRST mint, on the real pool, which mints at
// the acquire: a pane this device placed for a run, whose page was adopted before, comes back to a desk where nothing
// can serve its run a page. No lane was ever live in this mount, so no loss is seen and no probe is made: the mint's
// own refusal is the word, and the pane leaves by the host's one path.
describe("a run's pane after its run, on the real pool: the first mint of a mount is refused closed for good (2026-11-24)", () => {
  it("a pane this device placed leaves at the open's own mint, and nothing more is asked", async () => {
    const before = await wiredDesk();
    before.live.adoptMade("a", MADE);
    before.live.open("a", PAGE, () => {});
    await settle();
    expect(before.requests[0]).toMatchObject({ reuseKey: "a", made: MADE });
    before.live.dispose();
    before.pool.dispose();
    // the desk again (the app came back, or its cover lifted): the run is gone, and the mint says so
    const d = await wiredDesk();
    d.answers.push(() => {
      throw closedForGood();
    });
    const face = d.live.open("a", PAGE, () => {});
    await settle();
    expect(d.requests).toHaveLength(1);
    expect(d.requests[0]).not.toHaveProperty("made");
    expect(d.left).toEqual([["a", "closed"]]);
    expect(face.state()).toEqual({ is: "failed", reason: "run-ended" });
    await settle();
    expect(d.requests).toHaveLength(1);
    d.pool.dispose();
  });

  it("a pane this device did not place stays, on its closed still", async () => {
    const d = await wiredDesk();
    d.answers.push(() => {
      throw closedForGood();
    });
    const face = d.live.open("a", PAGE, () => {});
    await settle();
    expect(d.left).toEqual([]);
    expect(face.state()).toEqual({ is: "failed", reason: "run-ended" });
    d.pool.dispose();
  });
});
