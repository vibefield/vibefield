/**
 * PT-5b3 (ruling 7; PT-5b2's ruling 2) — WHEN the workspace session sweeps a board's page stills
 * (field/use-workspace-session.ts → surfaces/live/live-eyes.ts `sweepDocumentStills`): once, at the open of a board that
 * is WHOLE — this device's own saved copy, its journal applied, writable — by the board's id, with the keys of the
 * objects that stand. Never on the word of a NEW board (its objects may only not have arrived yet), a QUARANTINED blank,
 * a board refused from before the desk, or a DEGRADED one. The shelf is a spy; the engine and the documents are real.
 */
import {
  createCanvasEngine,
  defineQuery,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
} from "@vibecook/ice";
import { DESK_ENGINE } from "@vibecook/ice/desk/objects";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocManager, DocManagerState } from "../src/doc-manager";

const shelf = vi.hoisted(() => ({
  sweeps: [] as { docId: string; standing: string[] }[],
}));
vi.mock("../src/surfaces/live/page-stills", async (original) => ({
  ...(await original<typeof import("../src/surfaces/live/page-stills")>()),
  pageStills: () => ({
    sweep: async (docId: string, standing: readonly string[]) => {
      shelf.sweeps.push({ docId, standing: [...standing].sort() });
      return 0;
    },
  }),
}));

import { useWorkspaceSession } from "../src/field/use-workspace-session";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A desk board holding two notes: its saved bytes, and the notes' durable keys. */
function boardOfTwo(): { bytes: Uint8Array; keys: string[] } {
  const ce = createCanvasEngine(DESK_ENGINE);
  const session = ce.docs.create();
  ce.ops.spawnWidget("desk.note", { x: 0, y: 0, w: 200, h: 200, props: {} });
  ce.ops.spawnWidget("desk.note", { x: 400, y: 0, w: 200, h: 200, props: {} });
  ce.world.sync();
  const keys: string[] = [];
  ce.world.query(defineQuery([Position, Size, PrefabId, Not(Specimen)])).each((batch) => {
    for (const row of batch) {
      const key = session.store.keyOf(batch.entity(row)) as string | undefined;
      if (key !== undefined) keys.push(key);
    }
  });
  const bytes = session.exportEnvelope(1);
  ce.dispose();
  return { bytes, keys: keys.sort() };
}

/** A board from before the desk: an untyped engine's, rooted at `ice.default`. */
function preDeskBoard(): Uint8Array {
  const ce = createCanvasEngine();
  const bytes = ce.docs.create().exportEnvelope(1);
  ce.dispose();
  return bytes;
}

/** A lane that acknowledges every save at once (the session binds its persistence to it). */
const lane = {
  lastPutAt: null,
  put: async () => ({ revisionId: "r-checkpoint" }),
  putUpdate: async () => ({ revisionId: "r-update" }),
  onPush: () => () => undefined,
} as unknown as DocLaneClient;

async function open(pending: { initialBytes: Uint8Array | null; lane?: DocLaneClient | null }) {
  const state: DocManagerState = {
    phase: "loading",
    loading: { progress: 0, stage: "opening doc" },
    doc: null,
    docs: [],
    thumbnailUrls: {},
    pending: {
      generation: 5,
      docId: "pt5b3-swept",
      name: "Swept",
      lane: pending.lane === undefined ? lane : pending.lane,
      initialBytes: pending.initialBytes,
      initialUpdates: [],
      seed: false,
    },
  } as DocManagerState;
  const manager = {
    subscribe: () => () => undefined,
    getState: () => state,
    contentApplied: () => undefined,
    canvasPresented: () => undefined,
    refuseBeforeTheDesk: () => undefined,
    registerPersistence: () => () => undefined,
    stillOwed: () => undefined,
    keepStill: async () => undefined,
    registerStills: () => () => undefined,
    registerReopen: () => () => undefined,
    heldLiveElsewhere: async () => false,
    remount: async () => false,
  } as unknown as DocManager;
  function Harness() {
    useWorkspaceSession(manager);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  await act(async () => root.unmount());
  return shelf.sweeps;
}

describe("the boards whose page stills the session sweeps (PT-5b2 ruling 2, PT-5b3 ruling 7)", () => {
  beforeEach(() => {
    shelf.sweeps.length = 0;
  });

  it("a board opened WHOLE sweeps once — by its id, with the keys of the objects that stand", async () => {
    const board = boardOfTwo();
    expect(board.keys).toHaveLength(2);
    expect(await open({ initialBytes: board.bytes })).toEqual([
      { docId: "pt5b3-swept", standing: board.keys },
    ]);
  });

  it("a NEW board sweeps nothing: an object of it may only not have arrived yet", async () => {
    expect(await open({ initialBytes: null })).toEqual([]);
  });

  it("a QUARANTINED board sweeps nothing: its blank stand-in holds none of its objects", async () => {
    expect(await open({ initialBytes: new Uint8Array([1, 2, 3, 4, 5]) })).toEqual([]);
  });

  it("a board refused from before the desk, and a DEGRADED one (no lane to fieldd), sweep nothing", async () => {
    expect(await open({ initialBytes: preDeskBoard() })).toEqual([]);
    expect(await open({ initialBytes: boardOfTwo().bytes, lane: null })).toEqual([]);
  });
});
