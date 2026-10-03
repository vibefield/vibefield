/**
 * DK-4 — THE PACK MARKERS (DK-D17 ruled 2 Oct; r2 R5). ICE gates placement on a board's pack markers —
 * a kind whose pack the board does not carry is refused `pack-disabled` — and only
 * `docs.upgradeCapabilities` adds one. At every open the workspace session upgrades the board to what
 * is ON (the desk's kinds and every registered plugin's object kinds, a disabled plugin's excepted),
 * and a plugin enabled mid-session adds its own at the enable. Headless: the session hook mounted
 * over a board a narrower engine made, a plugin's object kind on a fake (GPU-less) kind.
 */
import { type CanvasEngine, createCanvasEngine, decodeEnvelope, type Entity } from "@vibecook/ice";
import { DESK_ENGINE, NOTE_TYPE } from "@vibecook/ice/desk/objects";
import { type PluginManifestV1, PluginRecord } from "@vibefield/contracts";
import type { ObjectBinding } from "@vibefield/plugin-sdk";
import { LoroDoc } from "loro-crdt";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DocManager, DocManagerState } from "../src/doc-manager";
import { capabilityTypes, upgradeFieldCapabilities } from "../src/field/desk/desk-capabilities";
import { useWorkspaceSession, type WorkspaceSession } from "../src/field/use-workspace-session";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { setPluginRegistrySnapshot } from "../src/plugin-host/plugin-registry-store";
import type { PreparedRendererPlugins } from "../src/plugin-host/staged-loader";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLUGIN = "com.example.dk4caps";
const CLOCK = `${PLUGIN}.clock`;

/** A desk kind's shape, headless (DK-2's clock): `isObjectKind` holds it; nothing creates its pass. */
function fakeKind(name: string) {
  return {
    name,
    stratum: "things",
    reach: 0,
    create: () => Promise.reject(new Error("no GPU in a unit test")),
    resolve: () => ({}),
    record: () => ({}),
    hit: () => "content",
  };
}

const manifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: PLUGIN,
  version: "0.1.0",
  title: "DK-4 capabilities",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onWidget:${CLOCK}`],
  capabilities: [],
  contributes: {
    objects: [
      {
        type: CLOCK,
        title: "Clock",
        schemaVersion: 1,
        size: { w: 160, h: 160 },
        provides: ["desk.object"],
        interaction: { selectable: true, movable: true },
        props: {},
        groups: {},
        tray: {
          category: "things",
          label: "Clock",
          hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] },
        },
        binding: { kind: "clock" },
      },
    ],
  },
};

const plugins: PreparedRendererPlugins = {
  generation: -1,
  staged: [],
  bundled: [
    {
      manifest,
      mod: { activate() {} },
      objectBindings: new Map<string, ObjectBinding>([[CLOCK, { kind: fakeKind(CLOCK) }]]),
    },
  ],
};

/** The plugin's row in fieldd's registry snapshot — on or off. */
function snapshot(enabled: boolean) {
  return {
    generation: enabled ? 2 : 1,
    plugins: [
      PluginRecord.parse({
        id: PLUGIN,
        version: "0.1.0",
        title: "DK-4 capabilities",
        source: "dev-linked",
        manifestHash: `sha256:${"c".repeat(64)}`,
        installRevision: "dk4-1",
        state: enabled ? "enabled" : "disabled",
        compatible: true,
        enabled,
        requestedCapabilities: [],
        grantedCapabilities: [],
        contributions: {},
        renderer: "inactive",
        service: "none",
      }),
    ],
    problems: [],
  };
}

/** A board a NARROWER engine made — the desk's six and nothing of this plugin's (another desktop's,
 * or this one's before the plugin came): its envelope names no pack of the clock. */
function boardWithoutThePlugin(): Uint8Array {
  const ce = createCanvasEngine(DESK_ENGINE);
  const bytes = ce.docs.create().exportEnvelope(1);
  ce.dispose();
  return bytes;
}

function mount(initialBytes: Uint8Array) {
  const state: DocManagerState = {
    phase: "loading",
    loading: { progress: 0, stage: "opening doc" },
    doc: null,
    docs: [],
    thumbnailUrls: {},
    pending: {
      generation: 1,
      docId: "dk4-capabilities",
      name: "Capabilities",
      lane: null,
      initialBytes,
      initialUpdates: [],
      seed: false,
    },
  };
  const manager = {
    subscribe: () => () => undefined,
    getState: () => state,
    contentApplied: () => undefined,
    canvasPresented: () => undefined,
    refuseBeforeTheDesk: () => undefined,
  } as unknown as DocManager;
  let session: WorkspaceSession | undefined;
  function Harness() {
    session = useWorkspaceSession(manager, plugins);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  return {
    render: () => act(async () => root.render(<Harness />)),
    unmount: () => act(async () => root.unmount()),
    session: (): WorkspaceSession => {
      if (session === undefined) throw new Error("the session did not mount");
      return session;
    },
  };
}

function rootFrame(ce: CanvasEngine): Entity {
  const current = ce.canvas.current();
  if (current.state !== "attached") throw new Error("no board attached");
  return current.frame;
}

afterEach(() => setPluginRegistrySnapshot({ generation: 0, plugins: [], problems: [] }));

describe("the pack markers — at every open, the packs of what is on", () => {
  it("a fresh board accepts a placement of each registered object type after open", async () => {
    const bytes = boardWithoutThePlugin();
    expect(decodeEnvelope(bytes).header.prefabVersions[CLOCK]).toBeUndefined();
    const m = mount(bytes);
    await m.render();
    const { ce, registry } = m.session();
    const frame = rootFrame(ce);
    const types = capabilityTypes(registry, null);
    expect(types).toContain(CLOCK);
    expect(types).toContain(NOTE_TYPE);
    types.forEach((type, i) => {
      expect(ce.placement.canPlace(type, frame), type).toMatchObject({ ok: true });
      expect(ce.ops.spawnWidget(type, { x: i * 400, y: 0, undoable: false })).toBeDefined();
    });
    await m.unmount();
  });

  it("stamps no disabled plugin's kind at the open — enabled mid-session, it places its kind", async () => {
    setPluginRegistrySnapshot(snapshot(false));
    const m = mount(boardWithoutThePlugin());
    await m.render();
    const { ce } = m.session();
    const frame = rootFrame(ce);
    expect(ce.placement.canPlace(CLOCK, frame)).toMatchObject({
      ok: false,
      reason: "pack-disabled",
    });
    expect(ce.placement.canPlace(NOTE_TYPE, frame)).toMatchObject({ ok: true });

    await act(async () => setPluginRegistrySnapshot(snapshot(true)));
    expect(ce.placement.canPlace(CLOCK, frame)).toMatchObject({ ok: true });
    expect(ce.ops.spawnWidget(CLOCK, { x: 0, y: 0, undoable: false })).toBeDefined();
    await m.unmount();
  });

  it("an enable met while the facade's gate holds the board is kept once the next publish judges it", async () => {
    setPluginRegistrySnapshot(snapshot(false));
    const bytes = boardWithoutThePlugin();
    const m = mount(bytes);
    await m.render();
    const { ce } = m.session();
    const frame = rootFrame(ce);
    // a peer's edit lands: the facade judges the board again at the next publish, writes held till then
    const peer = createCanvasEngine(DESK_ENGINE);
    const opened = peer.docs.open(bytes);
    if (!opened.ok) throw new Error(opened.reason);
    const outbound: Uint8Array[] = [];
    opened.session.store.subscribeOutbound((update) => outbound.push(update.slice()));
    peer.ops.spawnWidget(NOTE_TYPE, { x: 900, y: 900, undoable: false });
    peer.world.sync();
    ce.docs.current()?.applyRemote(outbound[0] as Uint8Array);

    await act(async () => setPluginRegistrySnapshot(snapshot(true)));
    expect(ce.placement.canPlace(CLOCK, frame)).toMatchObject({ reason: "pack-disabled" });
    await act(async () => {
      ce.step(16);
      await Promise.resolve();
    });
    expect(ce.placement.canPlace(CLOCK, frame)).toMatchObject({ ok: true });
    peer.dispose();
    await m.unmount();
  });

  it("writes nothing to a board that already carries them all — every open may ask again", () => {
    const registry = buildRegistry(plugins);
    const ce = createFieldEngine(registry);
    const session = ce.docs.create();
    upgradeFieldCapabilities(ce, registry, null);
    /** The board's Loro version: any write at all — a meta marker included — moves it. */
    const version = (): string => {
      const doc = new LoroDoc();
      doc.import(session.exportSnapshot());
      return JSON.stringify([...doc.oplogVersion().toJSON()]);
    };
    const before = version();
    expect(upgradeFieldCapabilities(ce, registry, null)).toBe(false);
    expect(version()).toBe(before);
    ce.dispose();
  });
});
