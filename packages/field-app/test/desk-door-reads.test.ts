// @vitest-environment node
// DK-8 — THE DESK DOOR'S TWO NEW READS (`window.__vfDesk`, what smoke:canvas's pad row reads): an object type's
// props — the cells of its groups, merged, never the pegboard's specimens — and the board's persistence row. Reads
// only: the door still writes no document.

import { defineQuery, type Entity, Local, Not, PresencePeer } from "@vibecook/ice";
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
    expect(read({ cursors: false })).toMatchObject({ record: null, facet: null });
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
});
