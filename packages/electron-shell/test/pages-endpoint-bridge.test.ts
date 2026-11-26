// EY-1 (2026-11-19) — the bridge as the broker drives it: a run's route on the socket's port; arm's one keyed URL for
// the launch; raced after a replay; a revoke that closes the run's sockets and leaves its grants; a grant answered with
// the page's DevTools id, a refusal by its word; a grant ended by the page it named even once its surface is gone; a
// call's refusals in order, read once and bounded; the person's hand on a granted surface told to the endpoint by the
// page its grant named (2026-11-24); and no URL or key in any log line. The real keyring; a fake endpoint and socket.
import { describe, expect, it, vi } from "vitest";
import type { BrowserAgentPort } from "../src/main/live-surfaces/browser-electron-native";
import { createKeyring } from "../src/main/pages/core/keys";
import {
  BRIDGE_OK,
  type BridgePage,
  type BridgeVerdict,
  type CallRefusal,
  type Keyring,
  type PageLease,
} from "../src/main/pages/core/types";
import {
  createPagesBridge,
  REFUSAL_CALLS_KEPT,
  REFUSALS_PER_CALL,
} from "../src/main/pages/endpoint/bridge";
import type { Endpoint } from "../src/main/pages/endpoint/endpoint";
import type { BridgeServer } from "../src/main/pages/endpoint/server";

const lease: PageLease = { runKey: "run-1", producerEpoch: 1, bindingRevision: 1 };

const fakePort = (targetId: string): BrowserAgentPort => ({
  targetId,
  openClientSession: async () => {
    throw new Error("not in these rows");
  },
  captureScale: () => 1,
  info: () => ({ url: "https://a.test/", title: "A" }),
  onDetach: () => () => {},
  pin: () => ({ applied: Promise.resolve("applied"), release: () => {} }),
  framesHoldFocus: () => false,
  viewImagePoint: (p) => p,
});

const facts = (pageId: string): Omit<BridgePage, "runKey"> => ({
  pageId,
  pageClass: "own",
  site: null,
  runFolder: null,
});

function harness(o: { readonly grant?: BridgeVerdict; readonly told?: number } = {}) {
  let keyring: Keyring | undefined;
  let sink: ((r: CallRefusal) => void) | undefined;
  const grants: { readonly runKey: string; readonly page: BridgePage }[] = [];
  const ungrants: [string, string][] = [];
  // the pages the endpoint was asked to say again (2026-11-24)
  const announced: string[] = [];
  // the endpoint's half of the person's hand (2026-11-24)
  const hand = {
    hold: vi.fn(async (_pageId: string) => {}),
    putDown: vi.fn(async (_pageId: string) => {}),
  };
  const endpoint: Endpoint = {
    grant: (runKey, page) => {
      grants.push({ runKey, page });
      return o.grant ?? BRIDGE_OK;
    },
    ungrant: (pageId, reason) => {
      ungrants.push([pageId, reason]);
    },
    connect: () => ({ message: async () => {}, closed: () => {} }),
    ...hand,
    announce: (pageId) => {
      announced.push(pageId);
      return o.told ?? 1;
    },
  };
  const closeRun = vi.fn();
  const server: BridgeServer = {
    listen: async () => ({ host: "127.0.0.1", port: 4567 }),
    close: async () => {},
    closeRun,
  };
  const surfaces = new Map<string, { page: Omit<BridgePage, "runKey">; port: BrowserAgentPort }>();
  const log = vi.fn();
  const bridge = createPagesBridge({
    makeKeyring: (deliver) => {
      keyring = createKeyring({ deliver });
      return keyring;
    },
    makeEndpoint: (refused) => {
      sink = refused;
      return endpoint;
    },
    makeServer: () => server,
    surfaceOf: (_run, surfaceId) => surfaces.get(surfaceId) ?? null,
    log,
  });
  return {
    bridge,
    keyring: () => keyring,
    refused: (r: CallRefusal) => sink?.(r),
    grants,
    ungrants,
    hand,
    announced,
    closeRun,
    surfaces,
    log,
  };
}

const pathOf = (url: string): string => (url.startsWith("ws://") ? new URL(url).pathname : "");

describe("the bridge as the broker drives it (EY-1 1d)", () => {
  it("adds a run's route on the socket's port, and arm hands back the launch's one keyed URL and its epoch", async () => {
    const h = harness();
    expect(await h.bridge.start()).toEqual({ port: 4567 });
    h.bridge.addRun("run-1");
    const first = h.bridge.arm("run-1");
    expect(first.url).toMatch(/^ws:\/\/127\.0\.0\.1:4567\/browser\/[0-9a-f]{32}\/[0-9a-f]{64}$/);
    expect(first.epoch).toBe(1);
    const second = h.bridge.arm("run-1");
    expect(second.epoch).toBe(2);
    expect(second.url).not.toBe(first.url);
    expect(
      h
        .keyring()
        ?.ledger("run-1")
        .map((row) => row.state),
    ).toEqual(["revoked", "unspent"]);
  });

  it("adds no run before it listens, and arms no run without a route", async () => {
    const h = harness();
    expect(() => h.bridge.addRun("run-1")).toThrow("not listening");
    await h.bridge.start();
    expect(() => h.bridge.arm("run-x")).toThrow();
  });

  it("says a run raced once its spent key is presented again", async () => {
    const h = harness();
    await h.bridge.start();
    h.bridge.addRun("run-1");
    const path = pathOf(h.bridge.arm("run-1").url);
    expect(h.bridge.raced("run-1")).toBe(false);
    expect(h.keyring()?.claim(path, "conn-1").ok).toBe(true);
    expect(h.bridge.raced("run-1")).toBe(false);
    expect(h.keyring()?.claim(path, "conn-2").ok).toBe(false);
    expect(h.bridge.raced("run-1")).toBe(true);
  });

  it("revokes a run's route and closes its sockets, its grants standing; the run may be added again", async () => {
    const h = harness();
    await h.bridge.start();
    h.bridge.addRun("run-1");
    const path = pathOf(h.bridge.arm("run-1").url);
    h.surfaces.set("S-a", { page: facts("S-a"), port: fakePort("DEVTOOLS-A") });
    await h.bridge.grant("run-1", "S-a", lease);
    await h.bridge.revokeRun("run-1");
    expect(h.closeRun).toHaveBeenCalledWith("run-1");
    expect(h.keyring()?.claim(path, "conn-1").ok).toBe(false);
    expect(h.ungrants).toEqual([]);
    h.bridge.addRun("run-1");
    expect(h.bridge.arm("run-1").epoch).toBe(1);
  });

  it("grants a surface's page with its DevTools id; the endpoint's refusal is its word; a surface with no port is not-handed", async () => {
    const h = harness();
    h.surfaces.set("S-a", { page: facts("S-a"), port: fakePort("DEVTOOLS-A") });
    expect(await h.bridge.grant("run-1", "S-a", lease)).toEqual({
      ok: true,
      targetId: "DEVTOOLS-A",
    });
    expect(h.grants).toEqual([{ runKey: "run-1", page: { ...facts("S-a"), runKey: "run-1" } }]);
    expect(await h.bridge.grant("run-1", "S-none", lease)).toEqual({
      ok: false,
      refused: "not-handed",
    });
    const refusing = harness({ grant: { ok: false, code: "no-lease", reason: "another run's" } });
    refusing.surfaces.set("S-a", { page: facts("S-a"), port: fakePort("DEVTOOLS-A") });
    expect(await refusing.bridge.grant("run-1", "S-a", lease)).toEqual({
      ok: false,
      refused: "no-lease",
    });
  });

  it("ends a grant by the page it named, even once its surface is gone", async () => {
    const h = harness();
    h.surfaces.set("S-a", { page: facts("S-a"), port: fakePort("DEVTOOLS-A") });
    await h.bridge.grant("run-1", "S-a", lease);
    h.surfaces.delete("S-a");
    await h.bridge.endGrant("run-1", "S-a");
    await h.bridge.endGrant("run-1", "S-a");
    expect(h.ungrants).toEqual([["S-a", "grant-end"]]);
  });

  it("tells the endpoint of the person's hand on a granted surface, by the page its grant named, and of no surface without a grant", async () => {
    const h = harness();
    h.surfaces.set("S-a", { page: facts("P-a"), port: fakePort("DEVTOOLS-A") });
    // before any grant the surface is no run's: nothing was left on it to undo
    h.bridge.hold("S-a");
    h.bridge.putDown("S-a");
    expect(h.hand.hold).not.toHaveBeenCalled();
    expect(h.hand.putDown).not.toHaveBeenCalled();
    await h.bridge.grant("run-1", "S-a", lease);
    h.bridge.hold("S-a");
    h.bridge.hold("S-other");
    expect(h.hand.hold.mock.calls).toEqual([["P-a"]]);
    h.bridge.putDown("S-a");
    h.bridge.putDown("S-other");
    expect(h.hand.putDown.mock.calls).toEqual([["P-a"]]);
    await h.bridge.endGrant("run-1", "S-a");
    h.bridge.hold("S-a");
    h.bridge.putDown("S-a");
    expect(h.hand.hold).toHaveBeenCalledTimes(1);
    expect(h.hand.putDown).toHaveBeenCalledTimes(1);
  });

  it("says a granted surface's page to the run's client again, by the page its grant named, to that run alone; nothing without a grant", async () => {
    // 2026-11-24, a new tab's first moments: the broker asks this for a page the engine's own list lacks
    const h = harness({ told: 2 });
    h.surfaces.set("S-a", { page: facts("P-a"), port: fakePort("DEVTOOLS-A") });
    expect(h.bridge.introduce("run-1", "S-a")).toBe(0);
    await h.bridge.grant("run-1", "S-a", lease);
    expect(h.bridge.introduce("run-1", "S-a")).toBe(2);
    // another run's word names no page of this one, and neither does a surface never granted
    expect(h.bridge.introduce("run-2", "S-a")).toBe(0);
    expect(h.bridge.introduce("run-1", "S-other")).toBe(0);
    expect(h.announced).toEqual(["P-a"]);
    await h.bridge.endGrant("run-1", "S-a");
    expect(h.bridge.introduce("run-1", "S-a")).toBe(0);
    expect(h.announced).toEqual(["P-a"]);
  });

  it("hands a call its refusals in order, once, and never another call's", () => {
    const h = harness();
    h.refused({ callId: "c-1", method: "Emulation.a", code: "forbidden" });
    h.refused({ callId: "c-2", method: "Page.navigate", code: "outside-window" });
    h.refused({ callId: "c-1", method: "Emulation.b", code: "forbidden" });
    expect(h.bridge.refusals("c-1").map((r) => r.method)).toEqual(["Emulation.a", "Emulation.b"]);
    expect(h.bridge.refusals("c-1")).toEqual([]);
    expect(h.bridge.refusals("c-2").map((r) => r.code)).toEqual(["outside-window"]);
  });

  it("keeps at most a call's bound of refusals, and lets go of a call never read once newer calls pass the bound", () => {
    const h = harness();
    for (let i = 0; i <= REFUSALS_PER_CALL; i += 1) {
      h.refused({ callId: "c-full", method: `M.${i}`, code: "forbidden" });
    }
    expect(h.bridge.refusals("c-full")).toHaveLength(REFUSALS_PER_CALL);
    h.refused({ callId: "c-old", method: "M.old", code: "forbidden" });
    for (let i = 0; i < REFUSAL_CALLS_KEPT; i += 1) {
      h.refused({ callId: `c-${i}`, method: "M", code: "forbidden" });
    }
    expect(h.bridge.refusals("c-old")).toEqual([]);
    expect(h.bridge.refusals(`c-${REFUSAL_CALLS_KEPT - 1}`)).toHaveLength(1);
  });

  it("logs no URL or key", async () => {
    const h = harness();
    await h.bridge.start();
    h.bridge.addRun("run-1");
    const { url } = h.bridge.arm("run-1");
    await h.bridge.revokeRun("run-1");
    expect(h.log.mock.calls.length).toBeGreaterThanOrEqual(2);
    const said = JSON.stringify(h.log.mock.calls);
    expect(said).not.toContain("/browser/");
    expect(url === "" || !said.includes(url)).toBe(true);
  });
});
