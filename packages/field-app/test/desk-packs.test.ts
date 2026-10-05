// @vitest-environment node
/**
 * DK-9 — A PACK LEARNED LIVE (field/desk/desk-packs.ts; DK-5 input (2)'s other half). A live update can carry a
 * pack marker this engine does not compile — a plugin's kind another desktop stamped while this one holds the
 * board — and ICE's version gate then holds the session read-only (`newerInDoc`). The watcher hears it on the
 * session's own remote door and asks to LEARN it (the board reopens on a ghost stub for the type — the
 * remount is DocManager's, held by its own test); a pack this realm cannot stub is STUCK, said once. The peer
 * here is a second engine in this process whose type the field's registry never defined, its outbound
 * records applied as a lane applies them.
 */
import {
  createCanvasEngine,
  type DocVersionReport,
  defineWidget,
  gateVerdict,
} from "@vibecook/ice";
import { DESK_ENGINE, DESK_OBJECTS } from "@vibecook/ice/desk/objects";
import { describe, expect, it, vi } from "vitest";
import { learnablePacks, watchPacksLearned } from "../src/field/desk/desk-packs";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { buildFacelessType } from "../src/plugin-host/build-widget";

/** A board the desk made, and a peer engine on it whose catalog has `peerType` too. */
function boardAndPeer(peerType: ReturnType<typeof defineWidget>) {
  const maker = createCanvasEngine(DESK_ENGINE);
  const bytes = maker.docs.create().exportEnvelope(1);
  maker.dispose();
  const peer = createCanvasEngine({ ...DESK_ENGINE, widgets: [...DESK_OBJECTS, peerType] });
  const opened = peer.docs.open(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const outbound: Uint8Array[] = [];
  opened.session.store.subscribeOutbound((update) => outbound.push(update.slice()));
  return { bytes, peer, outbound };
}

describe("a pack learned live (DK-9)", () => {
  it("a live update stamping a pack this engine does not compile holds the board — and the watcher asks to LEARN it, once", () => {
    const type = "vendor.dk9learn.dial";
    const { bytes, peer, outbound } = boardAndPeer(
      defineWidget({
        type,
        version: 1,
        props: {},
        defaultSize: { w: 100, h: 100 },
        provides: ["desk.object"],
      }),
    );
    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(bytes);
    if (!res.ok) throw new Error(res.reason);
    ce.world.sync();
    const learn = vi.fn();
    const stuck = vi.fn();
    const stop = watchPacksLearned(res.session, { learn, stuck });

    // another desktop places the kind there: its stamp and its object arrive as one live update
    peer.docs.upgradeCapabilities([type]);
    peer.ops.spawnWidget(type, { x: 0, y: 0, undoable: false });
    peer.world.sync();
    for (const update of outbound.splice(0)) res.session.applyRemote(update);

    expect(gateVerdict(res.session.versionReport())).not.toBe("ok"); // what DK-9 heals
    expect(res.session.versionReport().newerInDoc).toEqual([type]);
    expect(learn).toHaveBeenCalledTimes(1);
    expect(learn).toHaveBeenCalledWith([type]);
    expect(stuck).not.toHaveBeenCalled();
    // said once: a second update on the held board asks nothing more
    peer.ops.spawnWidget(type, { x: 200, y: 0, undoable: false });
    peer.world.sync();
    for (const update of outbound.splice(0)) res.session.applyRemote(update);
    expect(learn).toHaveBeenCalledTimes(1);
    stop();
    peer.dispose();
    ce.dispose();
  });

  it("a pack this realm cannot stub (not a plugin type) is STUCK, said once — the board stays read-only and says why", () => {
    const type = "dk9stuck";
    const { bytes, peer, outbound } = boardAndPeer(
      defineWidget({
        type,
        version: 1,
        props: {},
        defaultSize: { w: 100, h: 100 },
        provides: ["desk.object"],
      }),
    );
    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(bytes);
    if (!res.ok) throw new Error(res.reason);
    const learn = vi.fn();
    const stuck = vi.fn();
    const stop = watchPacksLearned(res.session, { learn, stuck });
    peer.docs.upgradeCapabilities([type]);
    peer.ops.spawnWidget(type, { x: 0, y: 0, undoable: false });
    peer.world.sync();
    for (const update of outbound.splice(0)) res.session.applyRemote(update);
    expect(learn).not.toHaveBeenCalled();
    expect(stuck).toHaveBeenCalledTimes(1);
    expect(stuck).toHaveBeenCalledWith([type]);
    stop();
    peer.dispose();
    ce.dispose();
  });

  it("learnable: a distributable type this engine does not compile and this realm never defined — nothing else", () => {
    buildFacelessType({
      type: "vendor.dk9defined.dial",
      schemaVersion: 1,
      size: { w: 1, h: 1 },
      props: {},
      groups: {},
    });
    const report = {
      newerInDoc: [
        "vendor.dk9fresh.dial",
        "vendor.dk9defined.dial",
        "vendor.dk9compiled.dial",
        "solo",
      ],
      localPacks: { "vendor.dk9compiled.dial": 1 },
    } as unknown as DocVersionReport;
    expect(learnablePacks(report)).toEqual(["vendor.dk9fresh.dial"]);
  });
});
