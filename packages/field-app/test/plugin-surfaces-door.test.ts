// DT-2b-2 — `ctx.pool.liveSurface`, driven through the REAL renderer harness.
//
// The seams under test are the ones a reviewer cannot check by reading: the
// key a plugin names is not the key the pool sees, the mint rides the plugin's
// own product client, the handle the plugin holds cannot reach a frame, and the
// activation's ownership tree — not the plugin — performs the release. So the
// harness is real and the two things BESIDE it are fakes: the surface pool (so
// the test can watch what the door asked of it) and the product client (so the
// test can watch what the mint sent).

import type {
  LiveSurfaceAttachTicketV1,
  LiveSurfaceSourceSpecV1,
  PluginModuleUrls,
  PluginRecord,
} from "@vibefield/contracts";
import type { PluginSurfaceHandle, RendererPluginContext } from "@vibefield/plugin-sdk";
import { describe, expect, it } from "vitest";
import { stageStagedRenderer } from "../src/plugin-host/renderer-harness";
import type {
  ProductSurfaceFrame,
  SurfaceAcquireOptions,
  SurfaceDemandRequest,
  SurfaceHandle,
  SurfaceHandleState,
  SurfacePool,
} from "../src/surfaces/pool";

const SOURCE: LiveSurfaceSourceSpecV1 = {
  kind: "browser",
  initialUrl: "https://example.invalid/dashboard",
  profile: { mode: "memory", ref: "fixture" },
  logicalViewport: { width: 800, height: 600 },
};

const TICKET: LiveSurfaceAttachTicketV1 = {
  v: 1,
  token: "door_test_ticket_token_0123456789_abcdefgh",
};

// ── the fakes ───────────────────────────────────────────────────────────────

interface AcquiredEntry {
  readonly key: string;
  readonly demands: SurfaceDemandRequest[];
  released: boolean;
  /** The door's ticket source, kept so a test can spend one mint deliberately. */
  mint(): Promise<LiveSurfaceAttachTicketV1>;
}

interface FakePool {
  readonly pool: SurfacePool<ProductSurfaceFrame>;
  readonly acquired: AcquiredEntry[];
}

function fakePool(): FakePool {
  const acquired: AcquiredEntry[] = [];
  const pool: SurfacePool<ProductSurfaceFrame> = {
    disposed: false,
    acquire(key: string, opts: SurfaceAcquireOptions): SurfaceHandle<ProductSurfaceFrame> {
      const entry: AcquiredEntry = {
        key,
        demands: [opts.initialDemand],
        released: false,
        mint: () => opts.tickets.mint(),
      };
      acquired.push(entry);
      const state = (): SurfaceHandleState<ProductSurfaceFrame> =>
        entry.released
          ? { status: "released", presentation: null, error: null }
          : { status: "attaching", presentation: null, error: null };
      return {
        key,
        get state() {
          return state();
        },
        get status() {
          return state().status;
        },
        presentation: null,
        error: null,
        onState(listener) {
          listener(state());
          return () => undefined;
        },
        setDemand(demand) {
          entry.demands.push(demand);
        },
        retry() {
          // Nothing attaches in this fake; retry is exercised by the pool's own suite.
        },
        release() {
          entry.released = true;
        },
      };
    },
    snapshot() {
      return {
        v: 1,
        disposed: false,
        liveAttachments: 0,
        pendingGraceTimers: 0,
        mints: 0,
        entries: [],
      };
    },
    dispose() {
      // The window owns the pool's lifetime, never an activation.
    },
  };
  return { pool, acquired };
}

interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
}

function recordingClient(calls: RecordedCall[]) {
  return {
    async request(method: string, params?: unknown): Promise<unknown> {
      calls.push({ method, params });
      if (method === "surface.open") {
        return { surfaceId: "surface_door_test_0001", ticket: TICKET };
      }
      return {};
    },
    async subscribe() {
      return { snapshot: {}, unsubscribe: () => undefined };
    },
  };
}

// ── the plugin under the harness ────────────────────────────────────────────

function record(id: string): PluginRecord {
  return {
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "bundled",
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "revision-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    deniedCapabilities: [],
    grantGeneration: 1,
    contributions: { widgets: [], commands: [], surfaces: [], capabilities: [] },
    renderer: "inactive",
    service: "none",
  } as unknown as PluginRecord;
}

function moduleRow(id: string): PluginModuleUrls {
  return {
    pluginId: id,
    moduleUrl: `vibefield-plugin://${id.padEnd(32, "0").slice(0, 32)}`,
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "revision-1",
  } as unknown as PluginModuleUrls;
}

interface Staged {
  readonly handles: PluginSurfaceHandle[];
  readonly calls: RecordedCall[];
  readonly acquired: AcquiredEntry[];
  readonly pluginId: string;
  deactivate(): Promise<void>;
}

let nextPluginId = 0;

/** Activate a plugin that acquires the surfaces `acquires` names, against a
 * fake pool (or none), and hand back everything both sides recorded. */
async function stageWithPool(
  poolFake: FakePool | null,
  acquires: readonly { key: string; reuseKey?: string }[],
): Promise<Staged> {
  nextPluginId += 1;
  const pluginId = `vibefield.doortest${nextPluginId}`;
  const handles: PluginSurfaceHandle[] = [];
  const calls: RecordedCall[] = [];
  const candidate = await stageStagedRenderer(
    record(pluginId),
    moduleRow(pluginId),
    {
      activate(ctx: RendererPluginContext) {
        for (const acquire of acquires) {
          handles.push(
            ctx.pool.liveSurface({
              key: acquire.key,
              source: SOURCE,
              ...(acquire.reuseKey === undefined ? {} : { reuseKey: acquire.reuseKey }),
              initialDemand: { mode: "live", targetFps: 30, priority: 50, interactive: false },
            }),
          );
        }
      },
    },
    {
      productClient: recordingClient(calls),
      resolveSurfacePool: () => poolFake?.pool ?? null,
    },
  );
  candidate.commit();
  return {
    handles,
    calls,
    acquired: poolFake?.acquired ?? [],
    pluginId,
    deactivate: () => candidate.dispose(),
  };
}

describe("ctx.pool.liveSurface", () => {
  it("answers a host with no live surfaces with a lost handle, never a throw", async () => {
    const staged = await stageWithPool(null, [{ key: "preview" }]);
    const handle = staged.handles[0];

    // Activation SUCCEEDED — the absence of a plane is a face, not a failure.
    expect(handle).toBeDefined();
    expect(handle?.status).toBe("lost");
    expect(handle?.error?.message).toBe("live surfaces are unavailable on this host");
    // And it says so to an observer immediately, the way a real handle does.
    const seen: string[] = [];
    handle?.onState((state) => seen.push(state.status));
    expect(seen).toEqual(["lost"]);
    // Nothing was minted: there was nothing to mint against.
    expect(staged.calls).toEqual([]);

    await staged.deactivate();
  });

  it("namespaces the pool key by plugin id so two plugins cannot collide", async () => {
    const pool = fakePool();
    const staged = await stageWithPool(pool, [{ key: "preview" }]);

    expect(staged.acquired.map((entry) => entry.key)).toEqual([`${staged.pluginId}:preview`]);

    await staged.deactivate();
  });

  it("mints through surface.open with source and reuseKey, and no idempotencyKey", async () => {
    const pool = fakePool();
    const staged = await stageWithPool(pool, [{ key: "preview", reuseKey: "card-7" }]);

    // The door builds the ticket source; spending one mint is what sends it.
    const ticket = await staged.acquired[0]?.mint();
    expect(ticket).toEqual(TICKET);

    expect(staged.calls).toHaveLength(1);
    const call = staged.calls[0];
    expect(call?.method).toBe("surface.open");
    expect(call?.params).toEqual({ source: SOURCE, reuseKey: "card-7" });
    // The pool's single-flight already prevents a client-side double mint; the
    // service's replay map is for WIRE retries, and a key here would fuse two
    // deliberate attempts into one already-spent ticket.
    expect(Object.keys(call?.params as Record<string, unknown>)).not.toContain("idempotencyKey");

    await staged.deactivate();
  });

  it("omits reuseKey entirely when the plugin named none", async () => {
    const pool = fakePool();
    const staged = await stageWithPool(pool, [{ key: "preview" }]);

    await staged.acquired[0]?.mint();
    expect(staged.calls[0]?.params).toEqual({ source: SOURCE });

    await staged.deactivate();
  });

  it("hands the plugin a handle with no presentation on it (PA-22)", async () => {
    const pool = fakePool();
    const staged = await stageWithPool(pool, [{ key: "preview" }]);
    const handle = staged.handles[0] as unknown as Record<string, unknown>;

    // Absent, not undefined-valued: a plugin must not be able to reach a frame
    // or a GPU object through this object at all.
    expect("presentation" in handle).toBe(false);
    expect(Object.keys(handle)).not.toContain("presentation");
    // What it DOES carry is the narrowed state.
    expect(staged.handles[0]?.status).toBe("attaching");

    await staged.deactivate();
  });

  it("releases every handle the plugin acquired when the activation closes", async () => {
    const pool = fakePool();
    const staged = await stageWithPool(pool, [
      { key: "preview" },
      { key: "detail" },
      { key: "thumb" },
    ]);

    expect(staged.acquired).toHaveLength(3);
    expect(staged.acquired.every((entry) => entry.released)).toBe(false);

    await staged.deactivate();

    // PRC-1: the ownership tree performs the release, so a plugin that forgot —
    // or one deactivated mid-frame — still cannot leak an attachment.
    expect(staged.acquired.map((entry) => entry.released)).toEqual([true, true, true]);
  });

  it("exposes the shipping view as the pool's only render path", async () => {
    const pool = fakePool();
    let view: unknown;
    nextPluginId += 1;
    const pluginId = `vibefield.doortest${nextPluginId}`;
    const candidate = await stageStagedRenderer(
      record(pluginId),
      moduleRow(pluginId),
      {
        activate(ctx: RendererPluginContext) {
          view = ctx.pool.SurfaceView;
        },
      },
      { productClient: recordingClient([]), resolveSurfacePool: () => pool.pool },
    );
    candidate.commit();

    expect(typeof view).toBe("function");

    await candidate.dispose();
  });
});
