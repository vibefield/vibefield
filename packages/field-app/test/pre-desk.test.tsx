/**
 * DK-3 — a board from BEFORE THE DESK is refused at open (the orchestrator's ruling 7; DK-D13…D16,
 * "drop them, a clean migration"): never opened, never converted.
 *
 * The rule reads the ENVELOPE before anything is imported — schema 3 made the root canvas a durable
 * identity and every legacy board binds to `ice.default` at 2→3 — with the opened document's own
 * root as the belt under the header's mirror. The workspace session then opens nothing (no ghost
 * stubs, no `docs.open`, no persistence), tells the manager, and lets the veil drop on the card.
 */
import {
  createCanvasEngine,
  DefaultCanvasType,
  decodeEnvelope,
  ENGINE_SCHEMA_VERSION,
  encodeEnvelope,
} from "@vibecook/ice";
import { DESK_ENGINE } from "@vibecook/ice/desk/objects";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DocManager, DocManagerState } from "../src/doc-manager";
import {
  isBeforeTheDesk,
  registryBeforeTheDesk,
  rootIsBeforeTheDesk,
} from "../src/field/desk/pre-desk";
import { useWorkspaceSession, type WorkspaceSession } from "../src/field/use-workspace-session";

/** Every engine the session makes, its `docs.open` counted: "never opened" is a count of zero. */
const opens = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/field-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/field-engine")>();
  return {
    ...actual,
    createFieldEngine: (...args: Parameters<typeof actual.createFieldEngine>) => {
      const ce = actual.createFieldEngine(...args);
      const open = ce.docs.open.bind(ce.docs);
      ce.docs.open = (bytes) => {
        opens.count += 1;
        return open(bytes);
      };
      return ce;
    },
  };
});

/** A board as the desk build makes it: rooted at `desk.desk`. */
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

describe("the rule, read from the envelope", () => {
  it("passes a desk board and refuses an `ice.default` board", () => {
    expect(decodeEnvelope(deskBoard()).header.rootCanvas?.id).toBe("desk.desk");
    expect(isBeforeTheDesk(deskBoard())).toBe(false);
    expect(decodeEnvelope(preDeskBoard()).header.rootCanvas?.id).toBe(DefaultCanvasType.id);
    expect(isBeforeTheDesk(preDeskBoard())).toBe(true);
  });

  it("refuses a schema-2 board: the 2→3 step would bind it to `ice.default`", () => {
    const { header, payload } = decodeEnvelope(deskBoard());
    const { rootCanvas: _root, ...rest } = header;
    expect(isBeforeTheDesk(encodeEnvelope({ ...rest, engineSchema: 2 }, payload))).toBe(true);
    expect(ENGINE_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("leaves an unreadable envelope to `docs.open`'s own quarantine", () => {
    expect(isBeforeTheDesk(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
  });

  it("judges an opened document by its own root, and the registry by its last save", () => {
    expect(rootIsBeforeTheDesk({ id: DefaultCanvasType.id, semanticVersion: 1 })).toBe(true);
    expect(rootIsBeforeTheDesk({ id: "desk.desk", semanticVersion: 1 })).toBe(false);
    expect(rootIsBeforeTheDesk(undefined)).toBe(false);
    expect(registryBeforeTheDesk(2)).toBe(true);
    expect(registryBeforeTheDesk(3)).toBe(false);
    expect(registryBeforeTheDesk(null)).toBe(false);
  });
});

describe("the workspace session refuses it at open", () => {
  function mount(initialBytes: Uint8Array) {
    const state: DocManagerState = {
      phase: "loading",
      loading: { progress: 0, stage: "opening doc" },
      doc: null,
      docs: [],
      thumbnailUrls: {},
      pending: {
        generation: 1,
        docId: "doc-before-the-desk",
        name: "Old board",
        lane: null,
        initialBytes,
        initialUpdates: [],
        seed: false,
      },
    };
    const trace: string[] = [];
    const manager = {
      subscribe: () => () => undefined,
      getState: () => state,
      contentApplied: () => trace.push("content-applied"),
      canvasPresented: () => undefined,
      refuseBeforeTheDesk: (docId: string) => trace.push(`refused:${docId}`),
    } as unknown as DocManager;
    let session: WorkspaceSession | undefined;
    opens.count = 0;
    function Harness() {
      session = useWorkspaceSession(manager);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    return { root, trace, harness: Harness, session: () => session };
  }

  it("opens nothing, tells the manager, and drops the veil on the card", async () => {
    const m = mount(preDeskBoard());
    await act(async () => m.root.render(<m.harness />));
    const session = m.session();
    expect(session?.beforeTheDesk).toBe(true);
    expect(session?.ce.docs.current()).toBeUndefined();
    expect(opens.count).toBe(0); // never opened: its envelope said so
    expect(m.trace).toEqual(["refused:doc-before-the-desk", "content-applied"]);
    await act(async () => m.root.unmount());
  });

  it("opens a desk board as ever", async () => {
    const m = mount(deskBoard());
    await act(async () => m.root.render(<m.harness />));
    expect(m.session()?.beforeTheDesk).toBe(false);
    expect(m.session()?.ce.docs.current()).toBeDefined();
    expect(opens.count).toBe(1);
    expect(m.trace).toEqual(["content-applied"]);
    await act(async () => m.root.unmount());
  });

  it("refuses by the opened document's own root when the header's mirror says otherwise", async () => {
    // a header that LIES: the desk's root mirror over an `ice.default` document
    const deskRoot = decodeEnvelope(deskBoard()).header.rootCanvas;
    if (deskRoot === undefined) throw new Error("a desk board carries its root");
    const old = decodeEnvelope(preDeskBoard());
    const lying = encodeEnvelope({ ...old.header, rootCanvas: deskRoot }, old.payload);
    expect(isBeforeTheDesk(lying)).toBe(false);
    const m = mount(lying);
    await act(async () => m.root.render(<m.harness />));
    expect(opens.count).toBe(1); // opened, read by its own root, closed before anything bound
    expect(m.session()?.ce.docs.current()).toBeUndefined();
    expect(m.trace).toEqual(["refused:doc-before-the-desk", "content-applied"]);
    await act(async () => m.root.unmount());
  });
});
