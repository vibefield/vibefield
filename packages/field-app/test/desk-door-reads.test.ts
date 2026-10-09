// @vitest-environment node
// DK-8 — THE DESK DOOR'S TWO NEW READS (`window.__vfDesk`, what smoke:canvas's pad row reads): an object type's
// props — the cells of its groups, merged, never the pegboard's specimens — and the board's persistence row. PT-1 adds
// each object's rect (what the browser pane's resize and re-cut wrote) and a kind's desk state by its name (the pane's
// witness of what its head says). Reads only: the door still writes no document.

import {
  defineQuery,
  type Entity,
  Local,
  NO_MODS,
  Not,
  PresencePeer,
  Viewport,
} from "@vibecook/ice";
import { COMMENT_PAD_TYPE } from "@vibefield/plugin-comment-pad";
import { afterEach, describe, expect, it } from "vitest";
import { setBoardStatus } from "../src/board-status";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects, installDeskDoor, type VfDeskDoor } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

afterEach(() => {
  setBoardStatus({ state: "booting" });
});

describe("the desk door's reads (DK-8)", () => {
  it("reads each object of a type with its props merged across its groups — the pad's ink and its dress together", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore());
    const pads = deskObjects(ce, COMMENT_PAD_TYPE);
    expect(pads).toHaveLength(1);
    expect(pads[0]?.props).toEqual({ text: "", seeds: "", pen: "ball", accent: "indigo", seed: 0 });
    expect(deskObjects(ce, "no.such.type")).toEqual([]);
    ce.dispose();
  });

  it("PT-1: reads each object's RECT beside its props — its Position and Size, what a resize writes — and a kind's DESK STATE by its name", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore());
    const pad = deskObjects(ce, COMMENT_PAD_TYPE)[0];
    expect(pad?.rect.w).toBe(220);
    expect(pad?.rect.h).toBe(280);
    expect(Number.isFinite(pad?.rect.x) && Number.isFinite(pad?.rect.y)).toBe(true);
    // the handle's `local(name)`, read through the door as it is — a kind's own witness of its objects
    const state = { said: () => "a word" };
    const undo = installDeskDoor(
      {
        engine: ce,
        handle: { local: (name: string) => (name === "some.kind" ? state : undefined) } as never,
        generation: 1,
        mount: 0,
        theme: "light",
      },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(door?.local("some.kind")).toBe(state);
    expect(door?.local("no.such.kind")).toBeUndefined();
    expect(door?.objects(COMMENT_PAD_TYPE)[0]?.rect).toEqual(pad?.rect);
    undo();
    // a handle with no such door (a test's) answers nothing
    const bare = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    expect((globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk?.local("some.kind")).toBeUndefined();
    bare();
    ce.dispose();
  });

  it("installed, it answers the same reads, and the board's persistence row as its status names it", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(door?.objects(COMMENT_PAD_TYPE)).toEqual([]);
    setBoardStatus({ state: "live", lastSavedAt: 1234 });
    expect(door?.board()).toEqual({ state: "live", lastSavedAt: 1234 });
    setBoardStatus({ state: "saving" });
    expect(door?.board()).toEqual({ state: "saving", lastSavedAt: null });
    undo();
    ce.dispose();
  });

  it("DK-12: reads the object IN HAND and where the desk drew it — the held pose seam's frame — and nothing when none is held", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore());
    ce.step(16);
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(door?.held()).toBeNull();
    const notebook = deskObjects(ce, "desk.notebook")[0]?.entity as Entity;
    ce.ops.open(notebook);
    // before the desk has drawn it: in hand, no frame yet
    expect(door?.held()).toEqual({ entity: notebook as number, frame: null });
    const drawn = { cx: 590, cy: 382, hx: 300, hy: 166, s: 1.4, settled: true };
    ce.stack.heldPose.current = { frame: (e) => (e === notebook ? drawn : undefined) };
    expect(door?.held()).toEqual({ entity: notebook as number, frame: drawn });
    ce.ops.putDown();
    expect(door?.held()).toBeNull();
    undo();
    ce.dispose();
  });

  it("DK-16: says whether the layer was mounted with ICE's remote cursors — false: none of ICE's drawn — and the peers' record", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const read = (handle: object) => {
      const undo = installDeskDoor(
        { engine: ce, handle: handle as never, generation: 1, mount: 0, theme: "light" },
        () => false,
      );
      const peers = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk?.peers();
      undo();
      return peers;
    };
    expect(read({ cursors: false })?.cursors).toBe(false);
    expect(read({})?.cursors).toBe(true); // absent, ICE's host draws them (I26)
    expect(read({ cursors: false })).toMatchObject({ record: null, said: null });
    ce.dispose();
  });

  it("DK-17b: waits for the PARK as the gate announces it (ICE I41) — at once when parked already, unparked at its time", async () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    if (door === undefined) throw new Error("no door");
    // no freeze, no park: the wait ends at its time, unparked
    expect(await door.whenParked(20)).toMatchObject({ parked: false, already: false });
    const thaw = ce.frame.freeze("cover");
    const waiting = door.whenParked(5_000);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    // the settle walk, stepped as a frame host steps it: the park lands as its last step ENDS
    let now = 0;
    for (let i = 0; i < 10 && ce.frame.claimStep(); i += 1) {
      await Promise.resolve();
      expect(settled).toBe(false);
      now += 16;
      ce.step(now);
    }
    expect(ce.frame.isParked()).toBe(true);
    expect(await waiting).toMatchObject({ parked: true, already: false });
    // the announcement is not replayed: a later wait reads the gate once — parked already
    expect(await door.whenParked(5_000)).toMatchObject({ parked: true, already: true });
    thaw();
    undo();
    ce.dispose();
  });

  it("DK-17b: says what this window says of its own pointer — ICE's presence (I42): the host's reason and its cursor", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    ce.docs.attachPresence({ name: "🦊 Tab", color: "#68686b" });
    const said = () => {
      const undo = installDeskDoor(
        {
          engine: ce,
          handle: { cursors: false } as never,
          generation: 1,
          mount: 0,
          theme: "light",
        },
        () => false,
      );
      const peers = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk?.peers();
      undo();
      return peers?.said;
    };
    // a session, no pointer published yet
    expect(said()).toEqual({ reason: null, cursor: null });
    let now = 0;
    const move = (x: number) => {
      ce.stack.queue.enqueue({
        kind: "move",
        pointerId: "mouse",
        device: "mouse",
        screenX: x,
        screenY: 40,
        buttons: 0,
        mods: NO_MODS,
      });
      for (let i = 0; i < 2; i++) {
        now += 16;
        ce.step(now);
      }
    };
    move(120);
    expect(said()).toEqual({ reason: null, cursor: { away: false, canvas: "" } });
    ce.docs.presence()?.setAway("cover");
    move(121);
    expect(said()).toEqual({ reason: "cover", cursor: { away: true, canvas: "" } });
    ce.dispose();
  });

  it("DK-16: installs the presence relay only on a page asked for it (`?presenceRelay=1`) — what this window sent out, and a peer's handed in", async () => {
    const make = () => {
      const ce = createFieldEngine(buildRegistry());
      ce.docs.create();
      ce.docs.attachPresence({ name: "🦊 Tab", color: "#68686b" });
      return ce;
    };
    const a = make();
    const b = make();
    const install = (ce: ReturnType<typeof make>) => {
      const undo = installDeskDoor(
        { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
        () => false,
      );
      const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk as VfDeskDoor;
      return { door, undo };
    };
    const g = globalThis as { location?: { search: string } };
    const before = g.location;
    try {
      g.location = { search: "" };
      const plain = install(a);
      expect(plain.door.presenceTap).toBeUndefined();
      expect(plain.door.presenceApply).toBeUndefined();
      plain.undo();
      g.location = { search: "?presenceRelay=1" };
      const doorA = install(a);
      const tapA = doorA.door.presenceTap;
      doorA.undo();
      const doorB = install(b);
      const applyB = doorB.door.presenceApply;
      doorB.undo();
      if (tapA === undefined || applyB === undefined) throw new Error("no relay installed");
      const remoteQ = defineQuery([PresencePeer, Not(Local)]);
      const seenByB = (): number => {
        let n = 0;
        b.world.query(remoteQ).each((batch) => {
          for (const _ of batch) n += 1;
        });
        return n;
      };
      const t0 = Date.now();
      let clock = 0;
      while (seenByB() === 0 && Date.now() - t0 < 3_000) {
        const sent = tapA();
        for (const payload of sent) expect(typeof payload).toBe("string"); // base64, a harness can carry it
        expect(applyB(sent)).toBe(sent.length);
        clock += 16;
        a.step(clock);
        b.step(clock);
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(seenByB()).toBe(1); // A's presence, relayed by the door as a mesh would, is a peer in B
    } finally {
      if (before === undefined) delete g.location;
      else g.location = before;
      a.dispose();
      b.dispose();
    }
  });

  it("DK-17b (ICE I45): the relay says the point this window's presence FIRST sent out — its pointer's own, never (0, 0)", async () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    ce.docs.attachPresence({ name: "🦊 Tab", color: "#68686b" });
    const g = globalThis as { location?: { search: string } };
    const before = g.location;
    g.location = { search: "?presenceRelay=1" };
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    try {
      const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk as VfDeskDoor;
      const first = door.presenceFirst;
      const tap = door.presenceTap;
      if (first === undefined || tap === undefined) throw new Error("no relay installed");
      expect(first()).toBeNull(); // no cursor has gone out yet
      let now = 0;
      const move = (x: number, y: number): void => {
        ce.stack.queue.enqueue({
          kind: "move",
          pointerId: "mouse",
          device: "mouse",
          screenX: x,
          screenY: y,
          buttons: 0,
          mods: NO_MODS,
        });
        now += 16;
        ce.step(now); // ONE step: the spawn's own frame publishes (a frame-late world point said (0, 0) there)
      };
      /** the throttle sends on its own timer: wait for the first cursor out */
      const sent = async (): Promise<void> => {
        const t0 = Date.now();
        while (first() === null && Date.now() - t0 < 3_000) {
          tap();
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      move(120, 40); // the mouse pointer spawns on its first fact
      await sent();
      expect(first()).toEqual({ x: 120, y: 40 }); // its own (the camera at rest: world = screen), never (0, 0)
      move(300, 200);
      await new Promise((r) => setTimeout(r, 60));
      tap();
      expect(first()).toEqual({ x: 120, y: 40 }); // the FIRST, kept: a later point never replaces it
    } finally {
      undo();
      if (before === undefined) delete g.location;
      else g.location = before;
      ce.dispose();
    }
  });

  it("DK-16: installs the GPU faults only on a page asked for them (`?deskFaults=1`), on the mount's OWN device — lost, or one uncaptured error", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const calls: string[] = [];
    const device = {
      destroy: () => calls.push("destroy"),
      createBuffer: (d: { size: number; usage: number }) =>
        calls.push(`createBuffer ${d.size}/${d.usage}`),
      queue: {
        onSubmittedWorkDone: () => {
          calls.push("asked");
          return Promise.resolve();
        },
      },
    } as unknown as GPUDevice;
    let lent: GPUDevice | null = null;
    const install = () => {
      const undo = installDeskDoor(
        {
          engine: ce,
          handle: {} as never,
          generation: 1,
          mount: 0,
          theme: "light",
          device: () => lent,
        },
        () => false,
      );
      return { door: (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk as VfDeskDoor, undo };
    };
    const g = globalThis as { location?: { search: string } };
    const before = g.location;
    try {
      g.location = { search: "" };
      const plain = install();
      expect(plain.door.gpuFault).toBeUndefined();
      plain.undo();
      g.location = { search: "?deskFaults=1" };
      const asked = install();
      expect(asked.door.gpuFault?.("lose")).toBe(false); // no device yet: nothing to fault
      lent = device;
      expect(asked.door.gpuFault?.("error")).toBe(true);
      expect(asked.door.gpuFault?.("lose")).toBe(true);
      // each fault then asks the queue — the browser tells a sleeping desk's fault as it polls for the answer
      expect(calls).toEqual(["createBuffer 4/0", "asked", "destroy", "asked"]);
      asked.undo();
    } finally {
      if (before === undefined) delete g.location;
      else g.location = before;
      ce.dispose();
    }
  });
});
