/**
 * DK-4 — which boards the workspace session PICTURES (DK-D27): the stills are bound with the board's
 * persistence, so only a board whose saves reach fieldd ever gets one. A board the open QUARANTINED
 * shows a blank stand-in for bytes it never opened — a still of it would replace the board's true
 * picture in the explorer with a blank — and a board refused from before the desk has no desk at all.
 */
import { createCanvasEngine } from "@vibecook/ice";
import { DESK_ENGINE } from "@vibecook/ice/desk/objects";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { DocManager, DocManagerState } from "../src/doc-manager";
import { useWorkspaceSession } from "../src/field/use-workspace-session";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A board as the desk build makes it. */
function deskBoard(): Uint8Array {
  const ce = createCanvasEngine(DESK_ENGINE);
  const bytes = ce.docs.create().exportEnvelope(1);
  ce.dispose();
  return bytes;
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

async function mountWith(initialBytes: Uint8Array) {
  const state: DocManagerState = {
    phase: "loading",
    loading: { progress: 0, stage: "opening doc" },
    doc: null,
    docs: [],
    thumbnailUrls: {},
    pending: {
      generation: 3,
      docId: "dk4-pictured",
      name: "Pictured",
      lane,
      initialBytes,
      initialUpdates: [],
      seed: false,
    },
  };
  const registered: Array<[number, string]> = [];
  const manager = {
    subscribe: () => () => undefined,
    getState: () => state,
    contentApplied: () => undefined,
    canvasPresented: () => undefined,
    refuseBeforeTheDesk: () => undefined,
    registerPersistence: () => () => undefined,
    stillOwed: () => undefined,
    keepStill: async () => undefined,
    registerStills: (generation: number, docId: string) => {
      registered.push([generation, docId]);
      return () => undefined;
    },
  } as unknown as DocManager;
  function Harness() {
    useWorkspaceSession(manager);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  await act(async () => root.unmount());
  return registered;
}

describe("the boards the session pictures (DK-4, DK-D27)", () => {
  it("a board whose saves reach fieldd registers its stills, for its generation", async () => {
    expect(await mountWith(deskBoard())).toEqual([[3, "dk4-pictured"]]);
  });

  it("a QUARANTINED board is never pictured: its blank stand-in must not replace its picture", async () => {
    expect(await mountWith(new Uint8Array([1, 2, 3, 4, 5]))).toEqual([]);
  });

  it("a board from before the desk is never pictured: it has no desk", async () => {
    expect(await mountWith(preDeskBoard())).toEqual([]);
  });
});
