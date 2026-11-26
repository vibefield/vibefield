import type {
  LiveSurfaceAttachTicketV1,
  LiveSurfaceSimulatorDeviceRowV1,
  RendererParticipantIdentity,
  ShellSurfacesMintParams,
} from "@vibefield/contracts";
import { BROWSER_DESK_PROFILE_REF, SURFACE_LIMITS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it, vi } from "vitest";
import {
  LiveSurfaceAuthority,
  type LiveSurfaceAuthorityDeps,
  type LiveSurfaceRuntimeHandle,
  type LiveSurfaceSimulatorCensus,
} from "../src/main/live-surfaces/authority";
import {
  browserSurfacePartition,
  browserSurfaceProfileName,
} from "../src/main/live-surfaces/browser-security";

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

/** PT-S2: a phone bound by its device type and runtime — never a UDID. */
const PHONE_SOURCE = {
  kind: "ios-simulator-device",
  binding: {
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
  },
  crop: { mode: "auto" },
} as const;

const DEVICE_ROW = {
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
  name: "iPhone 17 Pro",
  booted: true,
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
    iosSimulatorDevice: vi.fn((surfaceId: string) => {
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

describe("EY-1: a browser page's state for the pages broker, by its surface", () => {
  it("answers the runtime's own state, and null for a runtime without one or an unknown surface", () => {
    const state = {
      parked: true,
      url: "https://example.test/kept",
      title: "Kept",
      logicalViewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
    };
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
    });
    const alice = participant("window-1", "document-1");
    const withState = fixture({
      factories: {
        browser: (surfaceId: string) => ({ ...runtime(surfaceId), agentPageState: () => state }),
        sckWindow: runtime,
        iosSimulator: runtime,
        iosSimulatorDevice: runtime,
      },
    });
    withState.windows.set(alice.incarnation, { webContentsId: 7 });
    const page = withState.authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(withState.authority.agentPageState(page.surfaceId)).toEqual(state);
    expect(withState.authority.agentPageState("surface_unknown_00000000")).toBeNull();
    const without = fixture();
    without.windows.set(alice.incarnation, { webContentsId: 7 });
    const plain = without.authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(without.authority.agentPageState(plain.surfaceId)).toBeNull();
  });
});

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
      factories: {
        browser: runtime,
        sckWindow: runtime,
        iosSimulator: runtime,
        iosSimulatorDevice: runtime,
      },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(authority.state()).toEqual({
      runtimes: 2,
      owners: 2,
      emulations: 0,
      frameKeysRefused: 0,
      handInFlight: 0,
      pullOnly: 0,
      childSessions: 0,
      childSessionsBy: {},
    });
    switched.set(a.surfaceId, 2);
    switched.set(b.surfaceId, 1);
    expect(authority.state().emulations).toBe(3);
    // a page let go keeps its count in the census
    expect(authority.release({ rendererParticipant: alice, surfaceId: a.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state()).toEqual({
      runtimes: 1,
      owners: 1,
      emulations: 3,
      frameKeysRefused: 0,
      handInFlight: 0,
      pullOnly: 0,
      childSessions: 0,
      childSessionsBy: {},
    });
    switched.set(b.surfaceId, 2);
    expect(authority.state().emulations).toBe(4);
  });

  it("PT-5d (M15): the census counts the key-like events its browser pages REFUSED because a frame of another site held the focus — each runtime's own count, those let go included: typing into such a frame is off, and the smoke's FRAME-TYPE reads that it was refused", () => {
    const refused = new Map<string, number>();
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
      frameKeysRefused: () => refused.get(surfaceId) ?? 0,
    });
    const { authority, windows } = fixture({
      factories: {
        browser: runtime,
        sckWindow: runtime,
        iosSimulator: runtime,
        iosSimulatorDevice: runtime,
      },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(authority.state().frameKeysRefused).toBe(0);
    refused.set(a.surfaceId, 5);
    refused.set(b.surfaceId, 1);
    expect(authority.state().frameKeysRefused).toBe(6);
    expect(authority.release({ rendererParticipant: alice, surfaceId: a.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state().frameKeysRefused).toBe(6);
  });

  it("PT-6a (K5): the census counts the hand's commands its browser pages have SENT and not yet had answered — each runtime's own count NOW (a page that went keeps none in flight): what a row reads to know a page's chain is stalled", () => {
    const inFlight = new Map<string, number>();
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
      handInFlight: () => inFlight.get(surfaceId) ?? 0,
    });
    const { authority, windows } = fixture({
      factories: {
        browser: runtime,
        sckWindow: runtime,
        iosSimulator: runtime,
        iosSimulatorDevice: runtime,
      },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(authority.state().handInFlight).toBe(0);
    inFlight.set(a.surfaceId, 1);
    inFlight.set(b.surfaceId, 2);
    expect(authority.state().handInFlight).toBe(3);
    expect(authority.release({ rendererParticipant: alice, surfaceId: a.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state().handInFlight).toBe(2);
  });

  it("PT-6a (M4, M5 — F1): the census counts main's pages whose current document is PULL-ONLY — each runtime's own count NOW (a page that went keeps none): what FRAME-OPENED reads to say which word carried its keys", () => {
    const pulled = new Map<string, number>();
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
      pullOnly: () => pulled.get(surfaceId) ?? 0,
    });
    const { authority, windows } = fixture({
      factories: {
        browser: runtime,
        sckWindow: runtime,
        iosSimulator: runtime,
        iosSimulatorDevice: runtime,
      },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(authority.state().pullOnly).toBe(0);
    pulled.set(a.surfaceId, 1);
    pulled.set(b.surfaceId, 1);
    expect(authority.state().pullOnly).toBe(2);
    expect(authority.release({ rendererParticipant: alice, surfaceId: a.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state().pullOnly).toBe(1);
  });

  it("PT-6a (M8 — C5): the census counts the sessions of main's pages' frames of other sites — each runtime's own count NOW (a page that went keeps none): what FRAME-SESSIONS reads to know a frame's session outlived its document", () => {
    const sessions = new Map<string, number>();
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
      childSessions: () => sessions.get(surfaceId) ?? 0,
    });
    const { authority, windows } = fixture({
      factories: {
        browser: runtime,
        sckWindow: runtime,
        iosSimulator: runtime,
        iosSimulatorDevice: runtime,
      },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    expect(authority.state().childSessions).toBe(0);
    sessions.set(a.surfaceId, 2);
    sessions.set(b.surfaceId, 3);
    expect(authority.state().childSessions).toBe(5);
    expect(authority.release({ rendererParticipant: alice, surfaceId: a.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state().childSessions).toBe(3);
  });

  it("PT-6a (M14 — R3): the census gives each runtime's frame sessions by its SURFACE (`childSessionsBy`) — what FRAME-SESSIONS reads of its own pane, never another page's; a runtime that counts none is absent; one released is gone", () => {
    const sessions = new Map<string, number>();
    const runtime = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
      childSessions: () => sessions.get(surfaceId) ?? 0,
    });
    const capture = (surfaceId: string): LiveSurfaceRuntimeHandle => ({
      surfaceId,
      attach: () => {
        throw new Error("attach is the control session's job, not this suite's");
      },
      dispose: () => undefined,
    });
    const { authority, windows } = fixture({
      factories: {
        browser: runtime,
        sckWindow: capture,
        iosSimulator: capture,
        iosSimulatorDevice: capture,
      },
    });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const a = authority.mint(mintParams(alice, BROWSER_SOURCE));
    const b = authority.mint(mintParams(alice, BROWSER_SOURCE));
    sessions.set(a.surfaceId, 2);
    sessions.set(b.surfaceId, 7);
    expect(authority.state().childSessionsBy).toEqual({ [a.surfaceId]: 2, [b.surfaceId]: 7 });
    expect(authority.release({ rendererParticipant: alice, surfaceId: b.surfaceId })).toEqual({
      released: true,
    });
    expect(authority.state().childSessionsBy).toEqual({ [a.surfaceId]: 2 });
  });

  it("PT-S3 (D1): the census carries main's simulator census as `simulator` — read afresh at each state(), never before — and says none without the dep", () => {
    const census: LiveSurfaceSimulatorCensus = {
      sessions: 1,
      sessionsMade: 2,
      captureReady: true,
      helperPresent: true,
      helper: { helperStarts: 1, helperExits: 0, activeSessions: 1, framesReceived: 12 },
      vetted: "fallback",
    };
    let reads = 0;
    const { authority } = fixture({
      simulatorCensus: () => {
        reads += 1;
        return { ...census, sessionsMade: census.sessionsMade + reads - 1 };
      },
    });
    expect(reads).toBe(0);
    expect(authority.state().simulator).toEqual(census);
    expect(authority.state().simulator?.sessionsMade).toBe(3);
    expect(reads).toBe(2);

    const { authority: bare } = fixture();
    expect(bare.state()).not.toHaveProperty("simulator");
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
    expect(authority.state()).toEqual({
      runtimes: 1,
      owners: 1,
      emulations: 0,
      frameKeysRefused: 0,
      handInFlight: 0,
      pullOnly: 0,
      childSessions: 0,
      childSessionsBy: {},
    });

    expect(authority.release({ rendererParticipant: after, surfaceId: first.surfaceId })).toEqual({
      released: true,
    });
    expect(disposed).toEqual([first.surfaceId]);
    expect(authority.state()).toEqual({
      runtimes: 0,
      owners: 0,
      emulations: 0,
      frameKeysRefused: 0,
      handInFlight: 0,
      pullOnly: 0,
      childSessions: 0,
      childSessionsBy: {},
    });
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
    expect(authority.state()).toEqual({
      runtimes: 0,
      owners: 0,
      emulations: 0,
      frameKeysRefused: 0,
      handInFlight: 0,
      pullOnly: 0,
      childSessions: 0,
      childSessionsBy: {},
    });
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
    expect(authority.state()).toEqual({
      runtimes: 0,
      owners: 0,
      emulations: 0,
      frameKeysRefused: 0,
      handInFlight: 0,
      pullOnly: 0,
      childSessions: 0,
      childSessionsBy: {},
    });
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

  it("PT-S2 (R10): a bound phone dedupes on its binding and crop EVEN WITH a reuse key, and its ticket carries the device acts", () => {
    const { authority, factories, windows, issued, disposed } = fixture();
    const alice = participant("window-1", "document-1");
    const bob = participant("window-2", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    windows.set(bob.incarnation, { webContentsId: 7 });

    const first = authority.mint(mintParams(alice, PHONE_SOURCE, { reuseKey: "phone-1" }));
    const second = authority.mint(mintParams(alice, PHONE_SOURCE, { reuseKey: "phone-2" }));
    const third = authority.mint(mintParams(bob, PHONE_SOURCE, { reuseKey: "phone-3" }));
    expect(factories.iosSimulatorDevice).toHaveBeenCalledTimes(1);
    expect(factories.iosSimulator).not.toHaveBeenCalled();
    expect(second.surfaceId).toBe(first.surfaceId);
    expect(third.surfaceId).toBe(first.surfaceId);
    expect(issued.map((binding) => binding.sourceKind)).toEqual([
      "ios-simulator-device",
      "ios-simulator-device",
      "ios-simulator-device",
    ]);
    // still view-only: its acts, never an input op
    for (const binding of issued) expect(binding.operations).toEqual(["view", "device"]);

    // another binding, or another crop, is another stream
    authority.mint(
      mintParams(alice, {
        ...PHONE_SOURCE,
        binding: {
          ...PHONE_SOURCE.binding,
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
        },
      }),
    );
    authority.mint(mintParams(alice, { ...PHONE_SOURCE, crop: { mode: "none" } }));
    expect(factories.iosSimulatorDevice).toHaveBeenCalledTimes(3);

    for (const owner of [alice, alice, bob]) {
      authority.release({ surfaceId: first.surfaceId, rendererParticipant: owner });
    }
    expect(disposed).toContain(first.surfaceId);
  });

  it("PT-S2 (R10): a reuse-keyed bound phone still re-binds across a renderer reload", () => {
    const { authority, factories, windows } = fixture();
    const before = participant("window-1", "document-1");
    windows.set(before.incarnation, { webContentsId: 7 });
    const first = authority.mint(mintParams(before, PHONE_SOURCE, { reuseKey: "phone-1" }));
    const after = participant("window-1", "document-2");
    windows.delete(before.incarnation);
    windows.set(after.incarnation, { webContentsId: 7 });
    const second = authority.mint(mintParams(after, PHONE_SOURCE, { reuseKey: "phone-1" }));
    expect(factories.iosSimulatorDevice).toHaveBeenCalledTimes(1);
    expect(second.surfaceId).toBe(first.surfaceId);
  });

  it("PT-S2 (R11): the attach's device list is redacted, re-parsed and bounded — a row carrying a UDID never leaves main", async () => {
    const rows: Record<string, unknown>[] = [
      { ...DEVICE_ROW, path: "/Users/someone/Library/Developer/CoreSimulator/Devices/X" },
      { ...DEVICE_ROW, booted: false, udid: "F93EABF3-4281-4EB5-A5F6-A550FBE95CDC" },
      { ...DEVICE_ROW, deviceType: "iPhone-17-Pro" },
      ...Array.from({ length: SURFACE_LIMITS.MAX_SIMULATOR_DEVICES + 10 }, () => ({
        ...DEVICE_ROW,
        booted: false,
      })),
    ];
    const { authority } = fixture({
      simulatorDevices: {
        list: async () => rows as unknown as readonly LiveSurfaceSimulatorDeviceRowV1[],
      },
    });
    const result = await authority.simulatorDevices();
    expect(result.devices).toHaveLength(SURFACE_LIMITS.MAX_SIMULATOR_DEVICES);
    expect(result.devices[0]).toEqual(DEVICE_ROW);
    for (const row of result.devices) {
      expect(Object.keys(row).sort()).toEqual(["booted", "deviceType", "name", "runtime"]);
    }
    expect(JSON.stringify(result)).not.toContain("F93EABF3");
    expect(JSON.stringify(result)).not.toContain("/Users/");
  });

  it("PT-S2 (R11): the runtimes installed here ride with the rows, the newest first — each re-parsed (CoreSimulator's ids only) and bounded; a source that says none says none", async () => {
    const IOS_26_5 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
    const { authority } = fixture({
      simulatorDevices: {
        list: async () => [DEVICE_ROW],
        runtimes: async () => [
          IOS_26_5,
          "F93EABF3-4281-4EB5-A5F6-A550FBE95CDC",
          "iOS 26.1",
          ...Array.from({ length: SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES + 10 }, () => IOS_26_5),
        ],
      },
    });
    const result = await authority.simulatorDevices();
    expect(result.devices).toEqual([DEVICE_ROW]);
    expect(result.runtimes).toHaveLength(SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES);
    expect(new Set(result.runtimes)).toEqual(new Set([IOS_26_5]));
    expect(JSON.stringify(result)).not.toContain("F93EABF3");
    const none = fixture({
      simulatorDevices: { list: async () => [], runtimes: async () => [] },
    });
    await expect(none.authority.simulatorDevices()).resolves.toEqual({
      devices: [],
      runtimes: [],
    });
  });

  it("PT-S2 (R11): the device list is UNAVAILABLE with no source, after dispose, or when the source fails", async () => {
    await expect(fixture().authority.simulatorDevices()).rejects.toEqual(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
    await expect(fixture({ simulatorDevices: null }).authority.simulatorDevices()).rejects.toEqual(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
    const failing = fixture({
      simulatorDevices: {
        list: async () => {
          throw new Error("simctl exploded");
        },
      },
    });
    await expect(failing.authority.simulatorDevices()).rejects.toEqual(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
    const empty = fixture({ simulatorDevices: { list: async () => [] } });
    await expect(empty.authority.simulatorDevices()).resolves.toEqual({ devices: [] });
    empty.authority.dispose();
    await expect(empty.authority.simulatorDevices()).rejects.toEqual(
      expect.objectContaining({ kind: "UNAVAILABLE" }),
    );
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

// BP-D10 (2026-11-25) — a PERSISTENT browser profile is a person's browser profile: main mints one only by a browser
// profile's id (the desk's, or a `p-` id), and refuses any other ref before a runtime, a session or a folder is made. A
// memory ref of any bounded shape (a run's session among them) mints as before.
describe("BP-D10 — a persistent mint names a browser profile's id, or nothing is made", () => {
  const named = `p-${"k7".repeat(10)}`;
  const persistent = (ref: string) =>
    ({
      ...BROWSER_SOURCE,
      profile: { mode: "persistent", ref },
    }) as ShellSurfacesMintParams["source"];

  /** a logger that keeps what was said, by level: its message too, so the never-its-text sweep reads every argument */
  function said() {
    const lines: { level: string; event: string; message: string; attrs: unknown }[] = [];
    const at =
      (level: string) =>
      (event: string, message: string, ...rest: unknown[]) => {
        lines.push({ level, event, message, attrs: rest.at(-1) });
      };
    const logger = {
      debug: at("debug"),
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      fatal: at("fatal"),
    } as unknown as Logger;
    return { logger, lines };
  }

  it("mints the desk's profile and a well-formed id, into DIFFERENT folders, each its own for a packaged shell", () => {
    const { authority, factories, windows } = fixture();
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const desk = authority.mint(mintParams(alice, persistent(BROWSER_DESK_PROFILE_REF)));
    const work = authority.mint(mintParams(alice, persistent(named)));
    expect(desk.surfaceId).not.toBe(work.surfaceId);
    expect(factories.browser).toHaveBeenCalledTimes(2);
    const [deskSource, workSource] = factories.browser.mock.calls.map(
      (call) => (call as unknown as [string, Parameters<typeof browserSurfaceProfileName>[0]])[1],
    );
    expect(deskSource?.profile).toEqual({ mode: "persistent", ref: BROWSER_DESK_PROFILE_REF });
    expect(workSource?.profile).toEqual({ mode: "persistent", ref: named });
    const folders = [deskSource, workSource].map((source) => {
      if (source === undefined) throw new Error("no source");
      return {
        unpackaged: browserSurfaceProfileName(source, false),
        packaged: browserSurfaceProfileName(source, true),
      };
    });
    expect(folders[0]?.unpackaged).not.toBe(folders[1]?.unpackaged);
    expect(folders[0]?.packaged).not.toBe(folders[1]?.packaged);
    for (const folder of folders) expect(folder.unpackaged).not.toBe(folder.packaged);
    // and Chromium's partitions are two as well
    expect(browserSurfacePartition(persistent(named) as never)).not.toBe(
      browserSurfacePartition(persistent(BROWSER_DESK_PROFILE_REF) as never),
    );
  });

  it("refuses a persistent mint by any other ref before any runtime is made, and logs its length and run prefix, never its text", () => {
    const { logger, lines } = said();
    const { authority, buildCount, factories, issued, windows } = fixture({ logger });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const refused = ["run:x", "", "../x", `p-${"a".repeat(33)}`, "Desk", "private profile name"];
    for (const ref of refused) {
      let thrown: unknown;
      try {
        authority.mint(mintParams(alice, persistent(ref), { reuseKey: "pane-1" }));
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(ref)).toEqual({ kind: "PRECONDITION_FAILED" });
    }
    expect(buildCount()).toBe(0);
    expect(factories.browser).not.toHaveBeenCalled();
    expect(issued).toEqual([]);
    expect(authority.state().runtimes).toBe(0);
    const refusals = lines.filter(
      (line) => line.event === "desktop.live_surfaces.profile_ref_refused",
    );
    expect(refusals.map((line) => line.level)).toEqual(refused.map(() => "warn"));
    expect(refusals.map((line) => line.attrs)).toEqual(
      refused.map((ref) => ({ length: ref.length, run: ref.startsWith("run:") ? 1 : 0 })),
    );
    const text = JSON.stringify(lines);
    for (const ref of refused.filter((ref) => ref.length > 1)) expect(text).not.toContain(ref);
    // the same window's well-formed mint still goes
    expect(() => authority.mint(mintParams(alice, persistent(named)))).not.toThrow();
    expect(buildCount()).toBe(1);
  });

  it("refuses it on the adopt path too: a made page's mint that asks for a persistent profile by a run's ref adopts nothing", () => {
    const { logger, lines } = said();
    const { authority, buildCount, windows } = fixture({ logger });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    expect(() =>
      authority.mint(
        mintParams(alice, persistent("run:r1"), { made: "surface_made_0000000001", reuseKey: "k" }),
      ),
    ).toThrow();
    expect(lines.map((line) => [line.event, line.attrs])).toEqual([
      ["desktop.live_surfaces.profile_ref_refused", { length: 6, run: 1 }],
    ]);
    expect(buildCount()).toBe(0);
  });

  it("leaves a MEMORY mint as before: a run's ref of no run main holds is refused bare by the run's own rule, any other memory ref mints", () => {
    const { logger, lines } = said();
    const { authority, buildCount, windows } = fixture({ logger });
    const alice = participant("window-1", "document-1");
    windows.set(alice.incarnation, { webContentsId: 7 });
    const memory = (ref: string) =>
      ({
        ...BROWSER_SOURCE,
        profile: { mode: "memory", ref },
      }) as ShellSurfacesMintParams["source"];
    expect(() => authority.mint(mintParams(alice, memory("run:x")))).toThrow();
    expect(lines.map((line) => line.event)).toContain("desktop.live_surfaces.run_session_refused");
    expect(lines.map((line) => line.event)).not.toContain(
      "desktop.live_surfaces.profile_ref_refused",
    );
    expect(buildCount()).toBe(0);
    for (const ref of ["t", "live-surfaces-browser-lab", "../x", "Desk"])
      authority.mint(mintParams(alice, memory(ref)));
    expect(buildCount()).toBe(4);
  });
});
