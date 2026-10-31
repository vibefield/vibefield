// @vitest-environment node
// DK-8 — THE DESK DOOR'S TWO NEW READS (`window.__vfDesk`, what smoke:canvas's pad row reads): an object type's
// props — the cells of its groups, merged, never the pegboard's specimens — and the board's persistence row. PT-1 adds
// each object's rect (what the browser pane's resize and re-cut wrote) and a kind's desk state by its name (the pane's
// witness of what its head says). Reads only: the door still writes no document.

import {
  Camera,
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
import { createDeskLiveSources } from "../src/surfaces/live/desk-live";
import { LIVE_PAGES_MAX } from "../src/surfaces/live/live-cap";
import { pageStills } from "../src/surfaces/live/page-stills";
import { createSimulatorDevices } from "../src/surfaces/live/simulator-devices";
import { SURFACE_POOL_GRACE_MS } from "../src/surfaces/pool";

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

  it("PT-1: reads each object's RECT beside its props — its Position and Size, what a resize writes — a kind's DESK STATE by its name, and the CAMERA; PT-2: its durable KEY and the smokes' one WRITE", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore());
    const pad = deskObjects(ce, COMMENT_PAD_TYPE)[0];
    expect(pad?.rect.w).toBe(220);
    expect(pad?.rect.h).toBe(280);
    // PT-2 — its durable key, as the document holds it (a live face's key)
    expect(typeof pad?.key).toBe("string");
    expect(pad?.key).toBe(ce.docs.current()?.store.keyOf((pad?.entity ?? -1) as never));
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
    // PT-2 — the smokes' one write: a pad's text merged into its props in one transaction, one undo step back
    const padEntity = pad?.entity ?? -1;
    expect(door?.writeProps(padEntity, { text: "a line" })).toBe(true);
    expect(door?.objects(COMMENT_PAD_TYPE)[0]?.props.text).toBe("a line");
    expect(door?.objects(COMMENT_PAD_TYPE)[0]?.props.pen).toBe("ball");
    expect(ce.docs.undo()).toBe(true);
    ce.world.sync();
    expect(door?.objects(COMMENT_PAD_TYPE)[0]?.props.text).toBe("");
    expect(() => door?.writeProps(padEntity, { nonsense: 1 })).toThrow(/unknown prop/);
    expect(door?.writeProps(987_654, { text: "x" })).toBe(false);
    // the camera as the engine holds it: where the view's top-left stands in the world, and its zoom
    ce.world.setResource(Camera, { x: -120, y: 48, zoom: 2, gesturing: false });
    expect(door?.camera()).toEqual({ x: -120, y: 48, zoom: 2 });
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
    // PT-2 — no live service lent on this mount: no live read
    expect(door?.live()).toBeNull();
    setBoardStatus({ state: "live", lastSavedAt: 1234 });
    expect(door?.board()).toEqual({ state: "live", lastSavedAt: 1234 });
    setBoardStatus({ state: "saving" });
    expect(door?.board()).toEqual({ state: "saving", lastSavedAt: null });
    undo();
    ce.dispose();
  });

  it("PT-2: reads the mount's LIVE pages as its service counts them — its totals and each open face's row", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const live = createDeskLiveSources({
      pool: () => null,
      mintClient: () => null,
      gate: () => ({ type: "vibefield.browser-pane" }),
      device: () => undefined,
      writer: () => {
        throw new Error("no frame reaches a writer here");
      },
    });
    live.open(
      "13918995204487956201-1",
      {
        source: "browser",
        url: "http://127.0.0.1:1/page",
        viewport: [1280, 800],
        deviceScaleFactor: 2,
        scheme: "light",
        label: "x",
      },
      () => {},
    );
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light", live },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(door?.live()).toEqual({ stats: live.stats(), faces: live.faces() });
    expect(door?.live()?.faces[0]).toMatchObject({
      key: "13918995204487956201-1",
      // PT-5a: the desk MAY NOT — the SDK's word for it, the window's own after
      state: { is: "failed", reason: "may-not: live pages are unavailable in this window" },
    });
    expect(door?.live()?.stats).toMatchObject({ opened: 1, refused: 1, open: 1 });
    undo();
    ce.dispose();
  });

  it("PT-S3 (D5): reads this Mac's Simulator devices as the mount's service counts them — its looks, its reads and those that failed, the rows of its last read (null: none yet) — counts, never a row; nothing where no device list is lent", async () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const row = (name: string, booted: boolean) => ({
      deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
      name,
      booted,
    });
    let answer: unknown = {
      devices: [row("pts3-a1b2-1", true), row("iPhone 17 Pro", false)],
      runtimes: ["com.apple.CoreSimulator.SimRuntime.iOS-26-5"],
    };
    let clock = 0;
    const devices = createSimulatorDevices({
      mintClient: () => ({ request: () => Promise.resolve(answer) }),
      wanted: () => true,
      now: () => clock,
      // no timer runs: the test looks by hand
      timers: { set: () => 0, clear: () => {} },
    });
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light", devices },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    if (door === undefined) throw new Error("no door");
    // cold: nothing looked at, nothing read — the attach answers nothing yet
    expect(door.simulatorDevices()).toEqual({ looks: 0, reads: 0, failures: 0, rows: null });
    await devices.look();
    expect(door.simulatorDevices()).toEqual({ looks: 1, reads: 1, failures: 0, rows: 2 });
    // COUNTS: no row — no device's name — reaches the door
    expect(Object.keys(door.simulatorDevices() ?? {}).sort()).toEqual([
      "failures",
      "looks",
      "reads",
      "rows",
    ]);
    expect(JSON.stringify(door.simulatorDevices())).not.toContain("pts3");
    // a read that fails — a row that names a UDID, which the contract refuses — is counted, and the last read stands
    answer = {
      devices: [{ ...row("pts3-a1b2-1", true), udid: "1BD54690-0A1B-4C2D-8E3F-0123456789AB" }],
    };
    clock = 10_000;
    await devices.look();
    expect(door.simulatorDevices()).toEqual({ looks: 2, reads: 2, failures: 1, rows: 2 });
    undo();
    // a mount lent no device list reads none
    const bare = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    expect((globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk?.simulatorDevices()).toBeNull();
    bare();
    ce.dispose();
  });

  it("PT-5b: the TEST doors on the live pages — the cap read and set, the grace shortened and given back, the service's work awaited; and a pane's LAST STILL as the shelf keeps it, never its pixels", async () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const live = createDeskLiveSources({
      pool: () => null,
      mintClient: () => null,
      gate: () => ({ type: "vibefield.browser-pane" }),
      device: () => undefined,
      writer: () => {
        throw new Error("no frame reaches a writer here");
      },
    });
    const undo = installDeskDoor(
      {
        engine: ce,
        handle: {} as never,
        generation: 1,
        mount: 0,
        theme: "light",
        live,
        docId: "doc-door",
      },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    if (door === undefined) throw new Error("no door");
    // the cap: six, lowered to two, a number that is none left alone
    expect(door.liveCap()).toBe(LIVE_PAGES_MAX);
    expect(door.liveCap(2)).toBe(2);
    expect(live.stats().cap).toBe(2);
    expect(door.liveCap(0)).toBe(2);
    // the grace: the pool's own, a test's shorter one, the pool's own again
    expect(door.liveGrace()).toBe(SURFACE_POOL_GRACE_MS);
    expect(door.liveGrace(1_200)).toBe(1_200);
    expect(door.liveGrace()).toBe(1_200);
    expect(door.liveGrace(null)).toBe(SURFACE_POOL_GRACE_MS);
    await expect(door.liveSettled()).resolves.toBeUndefined();
    // a pane's last still: what it is a photograph of, its sizes, its type, how many bytes and when — not the picture
    expect(await door.pageStill("k-1")).toBeNull();
    const image = new Uint8Array([9, 8, 7, 6, 5]);
    await pageStills().keep("doc-door", "k-1", {
      address: "http://127.0.0.1:1/page",
      logical: [1280, 800],
      size: [1600, 1000],
      type: "image/webp",
      image,
      takenAt: 4_242,
    });
    const said = await door.pageStill("k-1");
    expect(said).toEqual({
      address: "http://127.0.0.1:1/page",
      logical: [1280, 800],
      size: [1600, 1000],
      type: "image/webp",
      bytes: 5,
      takenAt: 4_242,
      keptAt: expect.any(Number),
    });
    expect(JSON.stringify(said)).not.toContain("9,8,7");
    expect(Object.keys(said ?? {})).not.toContain("image");
    expect(await door.pageStills()).toMatchObject({ stills: 1 });
    // another document's desk reads none of it
    await pageStills().forget("doc-door", "k-1");
    expect(await door.pageStill("k-1")).toBeNull();
    undo();
    // a mount with no live service, no document: nothing to lower, nothing kept
    const bare = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    const none = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(none?.liveCap(3)).toBeNull();
    expect(await none?.pageStill("k-1")).toBeNull();
    bare();
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

  it("PT-5b (ruling 6): installs the DOCUMENT relay only on a page asked for it (`?docRelay=1`) — a peer joins by the document whole, follows it by its local commits, and what it applies it never hands back", async () => {
    const make = () => {
      const ce = createFieldEngine(buildRegistry());
      ce.docs.create();
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
      expect(plain.door.docSnapshot).toBeUndefined();
      expect(plain.door.docTap).toBeUndefined();
      expect(plain.door.docApply).toBeUndefined();
      plain.undo();
      g.location = { search: "?docRelay=1" };
      const doorA = install(a).door;
      const doorB = install(b).door;
      // A's board holds a pad; B joins by A's document whole: the SAME object, by its durable key
      a.ops.spawnWidget(COMMENT_PAD_TYPE, { x: 40, y: 40, w: 220, h: 280, props: {} });
      a.world.sync();
      const padA = deskObjects(a, COMMENT_PAD_TYPE)[0];
      if (padA === undefined || padA.key === null) throw new Error("no durable pad in A");
      expect(deskObjects(b, COMMENT_PAD_TYPE)).toEqual([]);
      const whole = doorA.docSnapshot?.() ?? null;
      expect(typeof whole).toBe("string");
      expect(doorB.docApply?.([whole as string])).toBe(1);
      b.world.sync();
      const padB = deskObjects(b, COMMENT_PAD_TYPE)[0];
      expect(padB?.key).toBe(padA.key);
      // what A sent out while it was laid is spent; A writes its pad's line: ONE local commit, handed to B as a lane's push
      doorA.docTap?.();
      doorB.docTap?.();
      expect(doorA.writeProps(padA.entity, { text: "a line" })).toBe(true);
      const sent = doorA.docTap?.() ?? [];
      expect(sent).toHaveLength(1);
      expect(doorA.docTap?.()).toEqual([]);
      expect(doorB.docApply?.(sent)).toBe(1);
      b.world.sync();
      expect(deskObjects(b, COMMENT_PAD_TYPE)[0]?.props.text).toBe("a line");
      // B applied it and wrote nothing of its own: nothing is handed back (no echo for the mesh to carry round)
      expect(doorB.docTap?.()).toEqual([]);
      // with no document open the relay answers none
      b.docs.close();
      expect(doorB.docSnapshot?.()).toBeNull();
      expect(doorB.docApply?.(sent)).toBe(0);
    } finally {
      if (before === undefined) delete g.location;
      else g.location = before;
      a.dispose();
      b.dispose();
    }
  });

  it("PT-5b (ruling 4): reads the desk's RASTER BUDGET as its ledger counts it — the cap, what is charged, by owner — and nothing on a handle with no ledger", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const stats = {
      cap: 268_435_456,
      used: 20_480_000,
      resident: 0,
      room: 268_435_456,
      entries: 2,
      evictions: 1,
      byOwner: { "vibefield.browser-pane": { bytes: 20_480_000, entries: 2 } },
    };
    const undo = installDeskDoor(
      {
        engine: ce,
        handle: { memory: () => stats } as never,
        generation: 1,
        mount: 0,
        theme: "light",
      },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(door?.budget()).toEqual({
      cap: 268_435_456,
      used: 20_480_000,
      entries: 2,
      evictions: 1,
      byOwner: { "vibefield.browser-pane": { bytes: 20_480_000, entries: 2 } },
    });
    undo();
    const bare = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    expect((globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk?.budget()).toBeNull();
    bare();
    ce.dispose();
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
