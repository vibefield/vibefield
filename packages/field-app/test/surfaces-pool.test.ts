// DT-2a — the window's live-surface attachment pool.
//
// The transport under test is the REAL `LiveSurfaceRendererTransport` driven
// over in-memory ports (the same harness idiom as
// packages/live-surfaces/test/renderer-transport.test.ts), not a structural
// fake. That matters for two of these cases specifically: the host's `detached`
// path closes an attachment WITHOUT ringing its summary observers, and
// `dispose()` on a dead port throws — both are transport behaviours the pool is
// built around, and a hand-written fake would have let the pool assume them
// away.
//
// Time is injected end to end: the pool's grace timers come from a fake clock,
// so nothing here waits on a real one.

import type { LiveSurfaceDemandV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import {
  type LiveSurfaceClosableFrame,
  type LiveSurfaceMessagePort,
  LiveSurfaceRendererTransport,
} from "@vibefield/live-surfaces/renderer";
import { describe, expect, it } from "vitest";
import {
  coalesceSurfaceDemand,
  createSurfacePool,
  SURFACE_POOL_GRACE_MS,
  type SurfaceDemandRequest,
  type SurfaceHandleState,
  type SurfacePoolTimers,
  type SurfaceTicketSource,
  setSurfaceGraceForTest,
  surfaceDemandIntentsEqual,
  surfaceGraceMs,
} from "../src/surfaces/pool";

const SURFACE_ID = "surface_0123456789abcdef";
const RENDERER_GENERATION = 3;

// ── the wire harness ────────────────────────────────────────────────────────

class MemoryPort implements LiveSurfaceMessagePort {
  onmessage: LiveSurfaceMessagePort["onmessage"] = null;
  onmessageerror: (() => void) | null = null;
  peer: MemoryPort | null = null;
  readonly sent: unknown[] = [];
  private readonly queued: unknown[] = [];
  private started = false;
  private closed = false;

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("memory port is closed");
    this.sent.push(message);
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

function summary(state: LiveSurfaceRuntimeSummaryV1["state"]): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId: SURFACE_ID,
    state,
    producerEpoch: 1,
    stateRevision: state === "live" ? 1 : 2,
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

interface AttachRequest {
  readonly requestId: string;
  readonly token: string;
}

/** A scripted main process on the other end of the two ports. */
class FakeSurfaceHost {
  readonly attaches: AttachRequest[] = [];
  readonly demands: { attachmentId: string; demand: LiveSurfaceDemandV1 }[] = [];
  readonly detaches: string[] = [];
  readonly attachmentIds: string[] = [];
  readonly transport: LiveSurfaceRendererTransport<LiveSurfaceClosableFrame>;
  #rejectNext: { code: string; message: string } | null = null;
  #nextAttachment = 0;

  constructor(
    private readonly control: MemoryPort,
    transport: LiveSurfaceRendererTransport<LiveSurfaceClosableFrame>,
  ) {
    this.transport = transport;
    this.control.onmessage = (event) => this.#accept(event.data);
  }

  get lastAttachmentId(): string {
    const last = this.attachmentIds.at(-1);
    if (last === undefined) throw new Error("no attachment has been granted");
    return last;
  }

  rejectNextAttach(code = "permission-denied", message = "denied by policy"): void {
    this.#rejectNext = { code, message };
  }

  /** The bare `detached` control message — the path that notifies NOBODY. */
  detach(attachmentId = this.lastAttachmentId): void {
    this.control.postMessage({ v: 1, type: "detached", attachmentId });
  }

  /** The closed-summary path, which DOES reach the attachment's observers. */
  closeBySummary(attachmentId = this.lastAttachmentId): void {
    this.control.postMessage({ v: 1, type: "summary", attachmentId, summary: summary("closed") });
  }

  #accept(raw: unknown): void {
    const message = raw as {
      type?: string;
      requestId?: string;
      attachmentId?: string;
      ticket?: { token?: string };
      demand?: LiveSurfaceDemandV1;
    };
    if (message.type === "attach" && message.requestId !== undefined) {
      this.attaches.push({
        requestId: message.requestId,
        token: message.ticket?.token ?? "",
      });
      const rejection = this.#rejectNext;
      if (rejection !== null) {
        this.#rejectNext = null;
        this.control.postMessage({
          v: 1,
          type: "rejected",
          requestId: message.requestId,
          error: {
            v: 1,
            code: rejection.code,
            message: rejection.message,
            recovery: "user-action",
          },
        });
        return;
      }
      this.#nextAttachment += 1;
      const attachmentId = `attachment_00000000000${this.#nextAttachment}`;
      this.attachmentIds.push(attachmentId);
      this.control.postMessage({
        v: 1,
        type: "attached",
        requestId: message.requestId,
        attachment: { v: 1, attachmentId, summary: summary("live") },
      });
      return;
    }
    if (message.type === "demand" && message.attachmentId !== undefined) {
      if (message.demand !== undefined) {
        this.demands.push({ attachmentId: message.attachmentId, demand: message.demand });
      }
      return;
    }
    if (message.type === "detach" && message.attachmentId !== undefined) {
      this.detaches.push(message.attachmentId);
    }
  }
}

async function fakeSurfaceHost(): Promise<FakeSurfaceHost> {
  const [rendererControl, hostControl] = channel();
  const [rendererFrames, hostFrames] = channel();
  hostControl.start();
  hostFrames.start();
  const transport = new LiveSurfaceRendererTransport<LiveSurfaceClosableFrame>(
    { v: 1, rendererGeneration: RENDERER_GENERATION },
    rendererControl,
    rendererFrames,
  );
  hostControl.postMessage({
    v: 1,
    type: "ready",
    bootstrap: { v: 1, rendererGeneration: RENDERER_GENERATION },
  });
  await transport.ready;
  return new FakeSurfaceHost(hostControl, transport);
}

// ── injected time and authority ─────────────────────────────────────────────

interface FakeClock {
  now(): number;
  readonly timers: SurfacePoolTimers;
  readonly pending: number;
  advance(ms: number): void;
}

function fakeClock(start = 1_000): FakeClock {
  let current = start;
  let sequence = 0;
  const armed = new Map<number, { at: number; fire: () => void }>();
  return {
    now: () => current,
    timers: {
      arm(callback, delayMs) {
        sequence += 1;
        const id = sequence;
        armed.set(id, { at: current + delayMs, fire: callback });
        return () => armed.delete(id);
      },
    },
    get pending(): number {
      return armed.size;
    },
    advance(ms: number): void {
      current += ms;
      for (const [id, timer] of [...armed]) {
        if (timer.at > current) continue;
        armed.delete(id);
        timer.fire();
      }
    },
  };
}

const TOKEN_MARKER = "TICKETSECRET";

interface CountingTicketSource extends SurfaceTicketSource {
  readonly minted: string[];
  /** Custody paid back, in close order — the surfaceIds the pool named. */
  readonly closed: string[];
}

function ticketSource(): CountingTicketSource {
  const minted: string[] = [];
  const closed: string[] = [];
  return {
    minted,
    closed,
    async mint() {
      const token = `${TOKEN_MARKER}_${"a".repeat(24)}_${minted.length + 1}`;
      minted.push(token);
      // A distinct custody id per mint: the authority counts owner MINTS, so
      // the conservation law under test is one close per mint, not per key.
      return { ticket: { v: 1, token }, surfaceId: `custody_${minted.length}` };
    },
    async close(surfaceId) {
      closed.push(surfaceId);
    },
  };
}

/** Flush every pending microtask by yielding to the macrotask queue once. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const GRACE_MS = 60_000;

async function poolHarness(): Promise<{
  host: FakeSurfaceHost;
  clock: FakeClock;
  tickets: CountingTicketSource;
  pool: ReturnType<typeof createSurfacePool<LiveSurfaceClosableFrame>>;
}> {
  const host = await fakeSurfaceHost();
  const clock = fakeClock();
  const tickets = ticketSource();
  const pool = createSurfacePool<LiveSurfaceClosableFrame>({
    transport: Promise.resolve(host.transport),
    now: () => clock.now(),
    graceMs: GRACE_MS,
    timers: clock.timers,
  });
  return { host, clock, tickets, pool };
}

const LIVE_30: SurfaceDemandRequest = {
  mode: "live",
  targetFps: 30,
  priority: 5,
  interactive: false,
};

// ── the cases ───────────────────────────────────────────────────────────────

describe("surface pool", () => {
  it("leaks nothing across acquire/release cycles once grace expires", async () => {
    const { host, clock, tickets, pool } = await poolHarness();

    for (let index = 0; index < 4; index += 1) {
      const handle = pool.acquire(`surface-${index}`, { tickets, initialDemand: LIVE_30 });
      await settle();
      expect(handle.status).toBe("live");
      handle.release();
      expect(handle.status).toBe("released");
    }

    // Held warm, not torn down: the grace window is the whole point — and a
    // warm attachment's custody is still in use, so nothing has closed yet.
    expect(pool.snapshot().liveAttachments).toBe(4);
    expect(pool.snapshot().pendingGraceTimers).toBe(4);
    expect(tickets.closed).toHaveLength(0);

    clock.advance(GRACE_MS);
    await settle();

    const snapshot = pool.snapshot();
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.liveAttachments).toBe(0);
    expect(snapshot.pendingGraceTimers).toBe(0);
    expect(clock.pending).toBe(0);
    expect(host.detaches).toHaveLength(4);
    expect(tickets.minted).toHaveLength(4);
    // The grace lapse is a permanent end (DT-D2): every mint is paid back.
    expect(tickets.closed.sort()).toEqual(["custody_1", "custody_2", "custody_3", "custody_4"]);
    expect(snapshot.custodyCloses).toBe(4);
  });

  it("shares one in-flight attach across concurrent acquires of one key", async () => {
    const { host, tickets, pool } = await poolHarness();

    const first = pool.acquire("shared", { tickets, initialDemand: LIVE_30 });
    const second = pool.acquire("shared", { tickets, initialDemand: LIVE_30 });
    expect(first.status).toBe("attaching");
    expect(second.status).toBe("attaching");

    await settle();

    expect(tickets.minted).toHaveLength(1);
    expect(host.attaches).toHaveLength(1);
    expect(first.status).toBe("live");
    expect(second.presentation).toBe(first.presentation);
    expect(pool.snapshot().mints).toBe(1);
  });

  it("reuses the live attachment when a re-acquire lands inside the grace window", async () => {
    const { host, clock, tickets, pool } = await poolHarness();

    const first = pool.acquire("panned", { tickets, initialDemand: LIVE_30 });
    await settle();
    const presentation = first.presentation;
    const attachmentId = host.lastAttachmentId;
    first.release();

    clock.advance(GRACE_MS / 2);
    const second = pool.acquire("panned", { tickets, initialDemand: LIVE_30 });
    await settle();

    expect(second.status).toBe("live");
    expect(second.presentation).toBe(presentation);
    expect(tickets.minted).toHaveLength(1);
    expect(host.attaches).toHaveLength(1);
    expect(host.detaches).toHaveLength(0);
    expect(host.lastAttachmentId).toBe(attachmentId);

    const snapshot = pool.snapshot();
    expect(snapshot.pendingGraceTimers).toBe(0);
    expect(snapshot.entries[0]?.holders).toBe(1);
    expect(clock.pending).toBe(0);
  });

  it("coalesces holders to the strongest intent at monotonic, never-repeated revisions", async () => {
    const { host, tickets, pool } = await poolHarness();

    const viewer = pool.acquire("folded", {
      tickets,
      initialDemand: {
        mode: "live",
        targetFps: 15,
        targetRasterSize: { width: 100, height: 100 },
        priority: 3,
        interactive: false,
      },
    });
    await settle();
    expect(host.demands.at(-1)?.demand).toMatchObject({
      mode: "live",
      targetFps: 15,
      priority: 3,
      interactive: false,
      targetRasterSize: { width: 100, height: 100 },
    });

    const editor = pool.acquire("folded", {
      tickets,
      initialDemand: {
        mode: "paused",
        targetFps: 0,
        targetRasterSize: { width: 300, height: 300 },
        priority: 7,
        interactive: true,
      },
    });
    await settle();

    // Strongest mode (live), greatest fps (15), greatest area (300×300),
    // greatest priority (7), interactive because ONE holder is.
    expect(host.demands.at(-1)?.demand).toMatchObject({
      mode: "live",
      targetFps: 15,
      priority: 7,
      interactive: true,
      targetRasterSize: { width: 300, height: 300 },
    });

    // A holder re-declaring the same intent moves no fold, so no wire traffic.
    const before = host.demands.length;
    editor.setDemand({
      mode: "paused",
      targetFps: 0,
      targetRasterSize: { width: 300, height: 300 },
      priority: 7,
      interactive: true,
    });
    expect(host.demands).toHaveLength(before);

    editor.setDemand({ mode: "live", targetFps: 60, priority: 7, interactive: true });
    expect(host.demands.at(-1)?.demand).toMatchObject({ mode: "live", targetFps: 60 });

    // The strongest holder leaving drops the fold back to the one that stayed.
    editor.release();
    expect(host.demands.at(-1)?.demand).toMatchObject({
      mode: "live",
      targetFps: 15,
      priority: 3,
      interactive: false,
    });

    // Nobody holding it is paused, not closed — the attachment stays.
    viewer.release();
    expect(host.demands.at(-1)?.demand).toMatchObject({ mode: "paused", targetFps: 0 });
    expect(pool.snapshot().liveAttachments).toBe(1);

    const revisions = host.demands.map((entry) => entry.demand.revision);
    expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
    expect(new Set(revisions).size).toBe(revisions.length);
    expect(revisions[0]).toBe(0);
  });

  it("rejects an incoherent demand at the caller's door", async () => {
    const { tickets, pool } = await poolHarness();
    expect(() =>
      pool.acquire("incoherent", {
        tickets,
        initialDemand: { mode: "live", targetFps: 0, priority: 0, interactive: false },
      }),
    ).toThrow(/non-zero FPS/u);
    expect(() =>
      pool.acquire("incoherent", {
        tickets,
        initialDemand: { mode: "paused", targetFps: 30, priority: 0, interactive: false },
      }),
    ).toThrow(/zero FPS/u);
  });

  it("marks handles lost when the host closes the attachment, and mints fresh on the next acquire", async () => {
    const { host, tickets, pool } = await poolHarness();

    const handle = pool.acquire("closed-by-host", { tickets, initialDemand: LIVE_30 });
    await settle();
    const states: SurfaceHandleState<LiveSurfaceClosableFrame>[] = [];
    handle.onState((state) => states.push(state));
    expect(states.at(-1)?.status).toBe("live");

    // The `detached` path clears the attachment's observers before anyone is
    // told, so the pool's own re-read is the only witness.
    host.detach();
    expect(handle.status).toBe("lost");
    expect(handle.presentation).toBeNull();

    const snapshot = pool.snapshot();
    expect(states.at(-1)?.status).toBe("lost");
    expect(snapshot.entries[0]?.status).toBe("lost");
    expect(snapshot.entries[0]?.failure).toBe("host-close");
    expect(snapshot.liveAttachments).toBe(0);

    // The loss settled the first mint's custody the moment the pool saw it.
    expect(tickets.closed).toEqual(["custody_1"]);

    const next = pool.acquire("closed-by-host", { tickets, initialDemand: LIVE_30 });
    await settle();
    expect(next.status).toBe("live");
    expect(tickets.minted).toHaveLength(2);
    expect(host.attaches).toHaveLength(2);
    // The second mint's custody is in use, not owed.
    expect(tickets.closed).toEqual(["custody_1"]);
  });

  it("notifies holders directly when the loss arrives as a closed summary", async () => {
    const { host, tickets, pool } = await poolHarness();
    const handle = pool.acquire("closed-by-summary", { tickets, initialDemand: LIVE_30 });
    await settle();
    const states: SurfaceHandleState<LiveSurfaceClosableFrame>[] = [];
    handle.onState((state) => states.push(state));

    host.closeBySummary();

    // No pool touchpoint in between: this path really does ring the observer.
    expect(states.at(-1)?.status).toBe("lost");
    expect(states.at(-1)?.error?.message).toMatch(/closed live surface attachment/u);
  });

  it("retries a lost surface without waiting for a new acquire", async () => {
    const { host, tickets, pool } = await poolHarness();

    const handle = pool.acquire("retried", { tickets, initialDemand: LIVE_30 });
    await settle();
    host.detach();
    expect(handle.status).toBe("lost");

    handle.retry();
    expect(handle.status).toBe("attaching");
    await settle();

    expect(handle.status).toBe("live");
    expect(handle.presentation).not.toBeNull();
    expect(tickets.minted).toHaveLength(2);
    expect(host.attaches).toHaveLength(2);
    expect(pool.snapshot().entries[0]?.failure).toBeNull();
    // Supersession: the dead attachment's mint paid back, the new one's held.
    expect(tickets.closed).toEqual(["custody_1"]);

    // Revisions never restart with the attachment they are declared against.
    const revisions = host.demands.map((entry) => entry.demand.revision);
    expect(new Set(revisions).size).toBe(revisions.length);
  });

  it("reports a rejected attach as lost, and recovers on retry", async () => {
    const { host, tickets, pool } = await poolHarness();
    host.rejectNextAttach();

    const handle = pool.acquire("rejected", { tickets, initialDemand: LIVE_30 });
    await settle();

    expect(handle.status).toBe("lost");
    expect(handle.error?.message).toMatch(/permission-denied/u);
    expect(pool.snapshot().entries[0]?.failure).toBe("attach");
    // The mint succeeded even though its use never began: still owed, and paid.
    expect(tickets.closed).toEqual(["custody_1"]);

    handle.retry();
    await settle();
    expect(handle.status).toBe("live");
    expect(tickets.minted).toHaveLength(2);
    expect(tickets.closed).toEqual(["custody_1"]);
  });

  it("drains everything on dispose, and disposes idempotently", async () => {
    const { host, clock, tickets, pool } = await poolHarness();

    const first = pool.acquire("a", { tickets, initialDemand: LIVE_30 });
    const second = pool.acquire("b", { tickets, initialDemand: LIVE_30 });
    await settle();
    const idle = pool.acquire("c", { tickets, initialDemand: LIVE_30 });
    await settle();
    idle.release();
    expect(pool.snapshot().pendingGraceTimers).toBe(1);

    pool.dispose();

    expect(first.status).toBe("released");
    expect(second.status).toBe("released");
    expect(first.presentation).toBeNull();
    expect(host.detaches).toHaveLength(3);
    expect(clock.pending).toBe(0);

    const snapshot = pool.snapshot();
    expect(snapshot.disposed).toBe(true);
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.liveAttachments).toBe(0);
    // Dispose is the window unloading: custody deliberately STANDS, because
    // reuse-keyed entries re-bind on reload and window death is main's own
    // cleanup. Attachments detach; mints are not paid back here.
    expect(tickets.closed).toHaveLength(0);
    expect(snapshot.custodyCloses).toBe(0);

    expect(() => pool.dispose()).not.toThrow();
    expect(host.detaches).toHaveLength(3);
    expect(() => pool.acquire("d", { tickets, initialDemand: LIVE_30 })).toThrow(/disposed pool/u);
  });

  it("survives a transport that dies under it, where detach itself throws", async () => {
    const { host, tickets, pool } = await poolHarness();
    const handle = pool.acquire("orphaned", { tickets, initialDemand: LIVE_30 });
    await settle();

    // The window generation ends: the host adapter disposes the transport on
    // pagehide, which closes every attachment without notifying, and any later
    // `detach` post throws on the closed port.
    host.transport.dispose();

    expect(handle.status).toBe("lost");
    expect(() => pool.dispose()).not.toThrow();
    expect(pool.snapshot().entries).toHaveLength(0);
    // Same unload story as dispose: custody survives for the next document.
    expect(tickets.closed).toHaveLength(0);
  });

  it("pays back a mint whose attach resolved after its entry was already dropped", async () => {
    const host = await fakeSurfaceHost();
    const clock = fakeClock();
    let releaseMint: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseMint = resolve;
    });
    const minted: string[] = [];
    const closed: string[] = [];
    const tickets: SurfaceTicketSource = {
      async mint() {
        await gate;
        const token = `${TOKEN_MARKER}_${"g".repeat(24)}_${minted.length + 1}`;
        minted.push(token);
        return { ticket: { v: 1, token }, surfaceId: `custody_gated_${minted.length}` };
      },
      async close(surfaceId) {
        closed.push(surfaceId);
      },
    };
    const pool = createSurfacePool<LiveSurfaceClosableFrame>({
      transport: Promise.resolve(host.transport),
      now: () => clock.now(),
      graceMs: GRACE_MS,
      timers: clock.timers,
    });

    // Acquire, release while the mint is still gated, and let grace lapse: the
    // entry is gone before the mint ever resolves.
    const handle = pool.acquire("late", { tickets, initialDemand: LIVE_30 });
    await settle();
    handle.release();
    clock.advance(GRACE_MS);
    expect(pool.snapshot().entries).toHaveLength(0);

    // Now the mint lands, the attach completes, and the pool wants none of it:
    // the attachment is disposed AND the mint is paid back — a ticket spent
    // into a dropped entry must not strand custody main-side.
    releaseMint();
    await settle();
    expect(minted).toHaveLength(1);
    expect(closed).toEqual(["custody_gated_1"]);
    expect(host.detaches).toHaveLength(1);
    expect(pool.snapshot().entries).toHaveLength(0);
  });

  it("keeps ticket tokens out of every pool state snapshot", async () => {
    const { host, tickets, pool } = await poolHarness();

    const handle = pool.acquire("secret", { tickets, initialDemand: LIVE_30 });
    await settle();
    handle.release();

    // The control: the token IS on the wire, so a snapshot that carried one
    // would be caught by the same search.
    expect(host.attaches[0]?.token).toContain(TOKEN_MARKER);
    expect(tickets.minted[0]).toContain(TOKEN_MARKER);

    expect(JSON.stringify(pool.snapshot())).not.toContain(TOKEN_MARKER);

    host.rejectNextAttach("security-rejected", `ticket ${TOKEN_MARKER} was refused`);
    const rejected = pool.acquire("secret-2", { tickets, initialDemand: LIVE_30 });
    await settle();

    // Even a host that echoes the token back in its rejection cannot put one in
    // the snapshot: failures are recorded as a stage, never as a message.
    expect(rejected.error?.message).toContain(TOKEN_MARKER);
    expect(JSON.stringify(pool.snapshot())).not.toContain(TOKEN_MARKER);
  });
});

// DT-3f — the fold's viewport rule, pinned at the unit: largest AREA wins and
// the winner's viewport travels WHOLE, because a source has one layout and a
// width from one holder crossed with a height from another names a layout
// nobody asked for.
describe("PT-5b — the pool's grace as a test may shorten it", () => {
  it("a grace given as a function is read each time a grace is ARMED — one already armed keeps its own", async () => {
    const host = await fakeSurfaceHost();
    const clock = fakeClock();
    const tickets = ticketSource();
    let grace = GRACE_MS;
    const pool = createSurfacePool<LiveSurfaceClosableFrame>({
      transport: Promise.resolve(host.transport),
      now: () => clock.now(),
      graceMs: () => grace,
      timers: clock.timers,
    });
    const a = pool.acquire("a", { tickets, initialDemand: LIVE_30 });
    await settle();
    a.release();
    expect(pool.snapshot().entries[0]?.graceDeadlineAt).toBe(clock.now() + GRACE_MS);
    // the grace is shortened: b's is the short one, a's stays as it was armed
    grace = 1_000;
    const b = pool.acquire("b", { tickets, initialDemand: LIVE_30 });
    await settle();
    b.release();
    expect(pool.snapshot().entries.find((e) => e.key === "b")?.graceDeadlineAt).toBe(
      clock.now() + 1_000,
    );
    clock.advance(1_000);
    await settle();
    expect(pool.snapshot().entries.map((e) => e.key)).toEqual(["a"]);
    clock.advance(GRACE_MS - 1_000);
    await settle();
    expect(pool.snapshot().entries).toEqual([]);
  });

  it("the window's pool reads the test door's grace: shortened, then the pool's own again; a number that is none is the pool's own", () => {
    expect(surfaceGraceMs()).toBe(SURFACE_POOL_GRACE_MS);
    expect(setSurfaceGraceForTest(1_500)).toBe(1_500);
    expect(surfaceGraceMs()).toBe(1_500);
    expect(setSurfaceGraceForTest(Number.NaN)).toBe(SURFACE_POOL_GRACE_MS);
    expect(setSurfaceGraceForTest(-1)).toBe(SURFACE_POOL_GRACE_MS);
    expect(setSurfaceGraceForTest(0)).toBe(0);
    expect(setSurfaceGraceForTest(null)).toBe(SURFACE_POOL_GRACE_MS);
    expect(SURFACE_POOL_GRACE_MS).toBe(60_000);
  });
});

describe("coalesceSurfaceDemand · logical viewport", () => {
  const live = (viewport?: { width: number; height: number }) => ({
    mode: "live" as const,
    targetFps: 30 as const,
    priority: 50,
    interactive: false,
    ...(viewport === undefined ? {} : { logicalViewport: viewport }),
  });

  it("takes the largest-area holder's viewport whole", () => {
    const folded = coalesceSurfaceDemand([
      live({ width: 640, height: 360 }),
      live({ width: 200, height: 900 }),
      live(),
    ]);
    expect(folded?.logicalViewport).toEqual({ width: 640, height: 360 });
  });

  it("stays absent when no holder has a layout opinion, and moves equality", () => {
    const folded = coalesceSurfaceDemand([live(), live()]);
    expect(folded?.logicalViewport).toBeUndefined();
    expect(
      surfaceDemandIntentsEqual(
        live({ width: 900, height: 532 }),
        live({ width: 900, height: 533 }),
      ),
    ).toBe(false);
    expect(
      surfaceDemandIntentsEqual(
        live({ width: 900, height: 532 }),
        live({ width: 900, height: 532 }),
      ),
    ).toBe(true);
  });
});
