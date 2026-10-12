import type {
  LiveSurfaceAttachTicketV1,
  RendererParticipantIdentity,
  ShellSurfacesMintParams,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  LiveSurfaceAuthority,
  type LiveSurfaceAuthorityDeps,
  type LiveSurfaceRuntimeHandle,
} from "../src/main/live-surfaces/authority";

interface IssuedBinding {
  surfaceId: string;
  sourceKind: string;
  operations: readonly string[];
  principalId?: string;
  authority: unknown;
}

function participant(id: string, incarnation: string): RendererParticipantIdentity {
  return { participantId: id, incarnation: `${id}:${incarnation}` };
}

const BROWSER_SOURCE = {
  kind: "browser",
  initialUrl: "https://example.test/",
  profile: { mode: "memory", ref: "t" },
  logicalViewport: { width: 320, height: 180 },
  deviceScaleFactor: 1,
} as const;

const SCK_SOURCE = {
  kind: "sck-window",
  sourceRef: "window-a",
  crop: { mode: "none" },
  captureCursor: false,
} as const;

function fixture(overrides?: Partial<LiveSurfaceAuthorityDeps>) {
  const disposed: string[] = [];
  let built = 0;
  const makeRuntime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
    surfaceId,
    attach: () => {
      throw new Error("attach is the control session's job, not this suite's");
    },
    dispose: () => {
      disposed.push(surfaceId);
    },
  });
  const issued: IssuedBinding[] = [];
  const windows = new Map<string, { webContentsId: number } | null>();
  const factories = {
    browser: vi.fn((surfaceId: string) => {
      built += 1;
      return makeRuntime(surfaceId);
    }),
    sckWindow: vi.fn((surfaceId: string) => {
      built += 1;
      return makeRuntime(surfaceId);
    }),
    iosSimulator: vi.fn((surfaceId: string) => {
      built += 1;
      return makeRuntime(surfaceId);
    }),
  };
  const host = {
    issue: vi.fn((binding: IssuedBinding): LiveSurfaceAttachTicketV1 => {
      issued.push(binding);
      return { v: 1, token: `ticket-${issued.length}-${"x".repeat(30)}` };
    }),
  };
  const deps: LiveSurfaceAuthorityDeps = {
    resolveWindow: (identity) => windows.get(identity.incarnation) ?? null,
    hostFor: (webContentsId) => (webContentsId === 7 ? (host as never) : null),
    factories,
    enumeration: {
      sckWindows: async () => [
        { sourceRef: "window-a", title: "Alpha", appName: "AlphaApp" },
        { sourceRef: "window-b", title: "Beta", appName: "BetaApp" },
      ],
      bootedSimulators: async () => [
        { sourceRef: "UDID-1", title: "iPhone 17 Pro", appName: "iOS 26.0" },
      ],
    },
    ...overrides,
  };
  const authority = new LiveSurfaceAuthority(deps);
  return { authority, factories, host, issued, disposed, windows, buildCount: () => built };
}

function mintParams(
  identity: RendererParticipantIdentity,
  source: ShellSurfacesMintParams["source"],
  extra?: Partial<ShellSurfacesMintParams>,
): ShellSurfacesMintParams {
  return { rendererParticipant: identity, source, ...extra };
}

describe("LiveSurfaceAuthority", () => {
  it("PT-5c2 (F4): the census counts the device switches its browser pages took — each runtime's own count, those let go included (it only grows): main's word that a device was told, the smoke's to read", () => {
    const switched = new Map<string, number>();
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
      emulations: () => switched.get(surfaceId) ?? 0,
    });
    const { authority, windows } = fixture({
      factories: { browser: runtime, sckWindow: runtime, iosSimulator: runtime },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(authority.state()).toEqual({ runtimes: 2, owners: 2, emulations: 0 });
    switched.set(a.surfaceId, 2);
    switched.set(b.surfaceId, 1);
    expect(authority.state().emulations).toBe(3);
    // a page let go keeps its count in the census
    expect(authority.release({ rendererParticipant: alice, surfaceId: a.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state()).toEqual({ runtimes: 1, owners: 1, emulations: 3 });
    switched.set(b.surfaceId, 2);
    expect(authority.state().emulations).toBe(4);
  });

  it("mints a browser runtime and issues a window-bound interaction ticket", () => {
    const { authority, factories, issued, windows } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });

    const result = authority.mint(mintParams(alice, BROWSER_SOURCE));

    expect(factories.browser).toHaveBeenCalledTimes(1);
    expect(result.surfaceId).toBe(issued[0]?.surfaceId);
    expect(result.ticket.token).toMatch(/^ticket-1/);
    expect(issued[0]).toMatchObject({
      sourceKind: "browser",
      // DT-D6: browser surfaces carry the human interaction ops.
      operations: ["view", "pointer", "keyboard", "navigate"],
      principalId: "window-1",
    });
  });

  it("refuses a stale or unknown renderer identity before touching producers", () => {
    const { authority, factories } = fixture();
    const stale = participant("window-1", "document-1");
    expect(() => authority.mint(mintParams(stale, BROWSER_SOURCE))).toThrowError(
      expect.objectContaining({ kind: "PRECONDITION_FAILED" }),
    );
    expect(factories.browser).not.toHaveBeenCalled();
  });

  it("answers UNAVAILABLE when the resolved window has no live surfaces host", () => {
    const { authority, windows } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 99 });
    expect(() => authority.mint(mintParams(alice, BROWSER_SOURCE))).toThrowError(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
  });

  it("stamps the plugin owner as the ticket principal", () => {
    const { authority, issued, windows } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    authority.mint(mintParams(alice, BROWSER_SOURCE, { owner: { pluginId: "vibefield.browser" } }));
    expect(issued[0]?.principalId).toBe("vibefield.browser");
  });

  it("dedupes capture mints on the canonical source and refcounts owners", () => {
    const { authority, factories, windows, disposed, issued } = fixture();
    const alice = participant("window-1", "document-1");
    const bob = participant("window-2", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    windows.set(bob.incarnation, { webContentsId: 7 });

    const first = authority.mint(mintParams(alice, SCK_SOURCE));
    const second = authority.mint(mintParams(bob, SCK_SOURCE));

    expect(factories.sckWindow).toHaveBeenCalledTimes(1);
    expect(second.surfaceId).toBe(first.surfaceId);
    expect(second.ticket.token).not.toBe(first.ticket.token);
    // DT-D6: capture stays view-only — no input op ever rides an sck ticket.
    expect(issued[0]?.operations).toEqual(["view"]);

    expect(authority.release({ surfaceId: first.surfaceId, rendererParticipant: alice })).toEqual({
      released: true,
    });
    expect(disposed).toHaveLength(0);
    expect(authority.release({ surfaceId: first.surfaceId, rendererParticipant: bob })).toEqual({
      released: true,
    });
    expect(disposed).toEqual([first.surfaceId]);
  });

  it("keeps a different crop as a different capture runtime", () => {
    const { authority, factories, windows } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    authority.mint(mintParams(alice, SCK_SOURCE));
    authority.mint(mintParams(alice, { ...SCK_SOURCE, captureCursor: true }));
    expect(factories.sckWindow).toHaveBeenCalledTimes(2);
  });

  it("re-binds a reuse-keyed runtime across a renderer reload", () => {
    const { authority, factories, windows } = fixture();
    const before = participant("window-1", "document-1");
    windows.set(before.incarnation, { webContentsId: 7 });
    const first = authority.mint(mintParams(before, BROWSER_SOURCE, { reuseKey: "entity-42" }));

    const after = participant("window-1", "document-2");
    windows.delete(before.incarnation);
    windows.set(after.incarnation, { webContentsId: 7 });
    const second = authority.mint(mintParams(after, BROWSER_SOURCE, { reuseKey: "entity-42" }));

    expect(factories.browser).toHaveBeenCalledTimes(1);
    expect(second.surfaceId).toBe(first.surfaceId);
  });

  it("a reload's re-bind forgives the gone document's mints: the new document's one close releases the page (PT-2)", () => {
    // the window's pool leaves custody standing when its document unloads (reload continuity), so the gone document's mint
    // is never paid back; were it still counted, the page would outlive the object that held it until the window closed
    const { authority, windows, disposed } = fixture();
    const before = participant("window-1", "document-1");
    windows.set(before.incarnation, { webContentsId: 7 });
    const first = authority.mint(mintParams(before, BROWSER_SOURCE, { reuseKey: "entity-42" }));

    const after = participant("window-1", "document-2");
    windows.delete(before.incarnation);
    windows.set(after.incarnation, { webContentsId: 7 });
    authority.mint(mintParams(after, BROWSER_SOURCE, { reuseKey: "entity-42" }));
    expect(authority.state()).toEqual({ runtimes: 1, owners: 1, emulations: 0 });

    expect(authority.release({ rendererParticipant: after, surfaceId: first.surfaceId })).toEqual({
      released: true,
    });
    expect(disposed).toEqual([first.surfaceId]);
    expect(authority.state()).toEqual({ runtimes: 0, owners: 0, emulations: 0 });
  });

  it("sweeps un-keyed runtimes whose minting document is gone", () => {
    const { authority, windows, disposed } = fixture();
    const before = participant("window-1", "document-1");
    windows.set(before.incarnation, { webContentsId: 7 });
    const orphan = authority.mint(mintParams(before, BROWSER_SOURCE));

    const after = participant("window-1", "document-2");
    windows.delete(before.incarnation);
    windows.set(after.incarnation, { webContentsId: 7 });
    authority.mint(mintParams(after, BROWSER_SOURCE));

    expect(disposed).toEqual([orphan.surfaceId]);
  });

  it("releases every runtime a destroyed window owned", () => {
    const { authority, windows, disposed } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, SCK_SOURCE));

    authority.releaseAllForWebContents(7);

    expect(new Set(disposed)).toEqual(new Set([a.surfaceId, b.surfaceId]));
    expect(authority.state()).toEqual({ runtimes: 0, owners: 0, emulations: 0 });
  });

  it("returns released:false for unknown surfaces and non-owners", () => {
    const { authority, windows } = fixture();
    const alice = participant("window-1", "document-1");
    const mallory = participant("window-9", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const minted = authority.mint(mintParams(alice, BROWSER_SOURCE));

    expect(
      authority.release({ surfaceId: "s-unknown-unknown-unknown", rendererParticipant: alice }),
    ).toEqual({ released: false });
    expect(
      authority.release({ surfaceId: minted.surfaceId, rendererParticipant: mallory }),
    ).toEqual({ released: false });
  });

  it("bounds total runtimes with RESOURCE_EXHAUSTED", () => {
    const { authority, windows } = fixture({ limits: { maxRuntimes: 1 } });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(() => authority.mint(mintParams(alice, BROWSER_SOURCE))).toThrowError(
      expect.objectContaining({ kind: "RESOURCE_EXHAUSTED" }),
    );
  });

  it("disposes a fresh runtime when the ticket table refuses", () => {
    const { authority, windows, disposed } = fixture({
      hostFor: () => ({
        issue: () => {
          throw new Error("cannot issue a Live Surface ticket without a live renderer generation");
        },
      }),
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    expect(() => authority.mint(mintParams(alice, BROWSER_SOURCE))).toThrowError(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
    expect(disposed).toHaveLength(1);
    expect(authority.state()).toEqual({ runtimes: 0, owners: 0, emulations: 0 });
  });

  it("maps ticket capacity onto RESOURCE_EXHAUSTED", () => {
    const { authority, windows } = fixture({
      hostFor: () => ({
        issue: () => {
          throw new Error("capacity");
        },
      }),
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    expect(() => authority.mint(mintParams(alice, BROWSER_SOURCE))).toThrowError(
      expect.objectContaining({ kind: "RESOURCE_EXHAUSTED" }),
    );
  });

  it("redacts enumeration rows to the contracts descriptor", async () => {
    const { authority } = fixture();
    const result = await authority.enumerate({ kind: "sck-window" });
    expect(result.sources).toEqual([
      { kind: "sck-window", sourceRef: "window-a", title: "Alpha", appName: "AlphaApp" },
      { kind: "sck-window", sourceRef: "window-b", title: "Beta", appName: "BetaApp" },
    ]);
    for (const row of result.sources) {
      expect(Object.keys(row).sort()).toEqual(["appName", "kind", "sourceRef", "title"]);
    }
    const simulators = await authority.enumerate({ kind: "ios-simulator" });
    expect(simulators.sources[0]).toEqual({
      kind: "ios-simulator",
      sourceRef: "UDID-1",
      title: "iPhone 17 Pro",
      appName: "iOS 26.0",
    });
  });

  it("answers UNAVAILABLE when enumeration has no capture stack", async () => {
    const { authority } = fixture({ enumeration: null });
    await expect(authority.enumerate({ kind: "sck-window" })).rejects.toEqual(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
  });

  it("dispose drains custody and refuses further work", () => {
    const { authority, windows, disposed } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const minted = authority.mint(mintParams(alice, BROWSER_SOURCE));
    authority.dispose();
    expect(disposed).toEqual([minted.surfaceId]);
    expect(() => authority.mint(mintParams(alice, BROWSER_SOURCE))).toThrowError(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
    authority.dispose();
  });
});
