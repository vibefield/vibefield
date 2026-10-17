// F1 (draft/thinking-freeway.md v0.3 §3, §4.3) — fieldd's half of the freeway, held to its policy
// with a scripted floor: the declaration fieldd's roster calls for, the floor's state as fieldd
// reads it (armed once, re-armed after a refusal, a stale revision ignored, a new floor boot taken
// whole), the declaration's delivery (every connect, every change, one at a time, newest last), and
// the serve — the floor-held listener's door, gated on the linked login, and silent until the floor
// has been read, so a restarted fieldd withdraws nothing it has not seen (FW-L10).
import { FreewayDeclareParams, type FreewayState, PORTS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  FREEWAY_SERVE_ID,
  FreewayFloor,
  type FreewayNative,
  type FreewayRoster,
  FreewayServeDriver,
  freewayDeclaration,
  freewayServeSpec,
} from "../src/freeway";
import type { ServeSpec } from "../src/mesh-client";

const LOGIN = "person@example.com";
const SECRET = "ab".repeat(32);

function roster(over: Partial<{ self: string; peers: string[]; desktops: string[] }> = {}) {
  const state = { self: "dev-a", peers: ["dev-b", "dev-p"], desktops: ["dev-b"], ...over };
  const view: FreewayRoster = {
    currentDeviceId: () => state.self,
    selfPeerDeviceIds: () => state.peers,
    isDocHost: (deviceId) => state.desktops.includes(deviceId),
  };
  return { state, view };
}

function floorState(over: Partial<FreewayState> = {}): FreewayState {
  return {
    revision: 1,
    up: true,
    floorBootId: "fb-1",
    hostBootId: "hb-1",
    port: 50_123,
    pathSecret: SECRET,
    localSecret: "cd".repeat(32),
    freewayKeyHex: "ef".repeat(32),
    keyGeneration: 1,
    links: [],
    ...over,
  };
}

/** The floor link, scripted: what was asked, and the stream's events to push. */
class ScriptedFloor implements FreewayNative {
  readonly declared: unknown[] = [];
  subscribes = 0;
  refuseSubscribe = false;
  refuseDeclare = false;
  /** while set, a declaration waits for it before the floor answers */
  hold: Promise<void> | null = null;
  snapshot: unknown = floorState();
  push: ((payload: unknown) => void) | null = null;
  disposed = 0;

  async request(method: string, params: unknown): Promise<unknown> {
    expect(method).toBe("native.freeway.declare");
    this.declared.push(params);
    if (this.hold !== null) await this.hold;
    if (this.refuseDeclare) throw new Error("the floor is restarting");
    return {};
  }

  async subscribe(
    method: string,
    _params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }> {
    expect(method).toBe("native.freeway.state.subscribe");
    this.subscribes += 1;
    await Promise.resolve();
    if (this.refuseSubscribe) throw new Error("METHOD_NOT_FOUND");
    this.push = (payload) => onEvent(payload, "delta");
    return { snapshot: this.snapshot, dispose: () => (this.disposed += 1) };
  }
}

function rig(over: { terminals?: boolean } = {}) {
  const native = new ScriptedFloor();
  const people = roster();
  const floor = new FreewayFloor({
    native,
    declaration: () => freewayDeclaration(people.view, over.terminals ?? true),
  });
  const heard: FreewayState[] = [];
  floor.on("state", (state: FreewayState) => heard.push(state));
  return { native, people, floor, heard };
}

describe("F1 — the declaration fieldd's roster calls for", () => {
  it("admits every self peer, desktops by the one predicate and phones the rest", () => {
    const declaration = freewayDeclaration(roster().view, true);
    expect(declaration).toEqual({
      deviceId: "dev-a",
      admit: [
        { deviceId: "dev-b", role: "desktop" },
        { deviceId: "dev-p", role: "phone" },
      ],
      doors: {},
      exposure: { terminals: true },
    });
    expect(FreewayDeclareParams.parse(declaration)).toEqual(declaration);
  });

  it("carries the owner's word on off-device terminals, and an empty roster admits no one", () => {
    const declaration = freewayDeclaration(roster({ peers: [] }).view, false);
    expect(declaration.admit).toEqual([]);
    expect(declaration.exposure).toEqual({ terminals: false });
  });
});

describe("F1 — the floor's state, as fieldd reads it", () => {
  it("arms the stream at the first connect and declares, reading the floor's snapshot", async () => {
    const { native, floor, heard } = rig();
    await floor.connected();
    expect(native.subscribes).toBe(1);
    expect(floor.state()).toEqual(floorState());
    expect(heard).toHaveLength(1);
    expect(native.declared).toEqual([freewayDeclaration(roster().view, true)]);
  });

  it("re-arms a refused first subscription at the next connect, and arms once per arming", async () => {
    const { native, floor } = rig();
    native.refuseSubscribe = true;
    await floor.connected();
    expect(floor.state()).toBeNull();
    // the declaration does not wait on the state: the floor hears fieldd's word regardless
    expect(native.declared).toHaveLength(1);
    native.refuseSubscribe = false;
    await Promise.all([floor.connected(), floor.connected()]);
    expect(native.subscribes).toBe(2);
    expect(floor.state()?.floorBootId).toBe("fb-1");
  });

  it("ignores a revision it has passed within a boot, and takes a new floor boot whole", async () => {
    const { native, floor, heard } = rig();
    native.snapshot = floorState({ revision: 5 });
    await floor.connected();
    native.push?.(floorState({ revision: 4, up: false }));
    native.push?.(floorState({ revision: 5, up: false }));
    expect(floor.state()?.up).toBe(true);
    native.push?.({ revision: 9 }); // not a state: the last good one stands
    expect(floor.state()?.revision).toBe(5);
    const reborn = floorState({ revision: 1, floorBootId: "fb-2", up: false });
    delete reborn.port;
    delete reborn.pathSecret;
    native.push?.(reborn);
    expect(floor.state()).toEqual(reborn);
    expect(heard.map((state) => [state.floorBootId, state.revision])).toEqual([
      ["fb-1", 5],
      ["fb-2", 1],
    ]);
  });

  it("declares at every connect and on every change, never twice for one word on one link", async () => {
    const { native, people, floor } = rig();
    await floor.connected();
    await floor.declare();
    expect(native.declared).toHaveLength(1);
    people.state.desktops = ["dev-b", "dev-p"];
    await floor.declare();
    expect(native.declared).toHaveLength(2);
    // a reconnect may be a new floor boot, which forgets: the same word is said again
    await floor.connected();
    expect(native.declared).toHaveLength(3);
    expect(native.declared[2]).toEqual(native.declared[1]);
  });

  it("sends one declaration at a time and reads the word at its turn, so the newest lands last", async () => {
    const { native, people, floor } = rig();
    let release = () => {};
    native.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = floor.declare();
    // the first turn runs (microtasks only, no clock): its declaration is on the wire, unanswered
    for (let turn = 0; turn < 10 && native.declared.length === 0; turn += 1)
      await Promise.resolve();
    expect(native.declared).toHaveLength(1);
    people.state.self = "dev-a2";
    const second = floor.declare();
    people.state.self = "dev-a3";
    const third = floor.declare();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(native.declared).toHaveLength(1);
    release();
    await Promise.all([first, second, third]);
    expect(native.declared.map((d) => (d as { deviceId: string }).deviceId)).toEqual([
      "dev-a",
      "dev-a3",
    ]);
  });

  it("says a refused declaration again at the next change, and stops at dispose", async () => {
    const { native, floor } = rig();
    native.refuseDeclare = true;
    await floor.connected();
    native.refuseDeclare = false;
    await floor.declare();
    expect(native.declared).toHaveLength(2);
    floor.dispose();
    expect(native.disposed).toBe(1);
    await floor.connected();
    await floor.declare();
    expect(native.declared).toHaveLength(2);
  });
});

describe("F1 — the freeway's serve", () => {
  it("is the floor-held listener's door, behind the linked login, on the freeway's own port", () => {
    expect(freewayServeSpec({ state: floorState(), linkedLogin: LOGIN })).toEqual({
      serveId: FREEWAY_SERVE_ID,
      name: FREEWAY_SERVE_ID,
      listenPort: PORTS.FREEWAY_SERVE,
      target: { kind: "port", port: 50_123 },
      tls: false,
      allow: [LOGIN],
      pathSecret: SECRET,
      secretDoor: "freeway",
    } satisfies ServeSpec);
  });

  it("is nothing without a host, without a login, or before the floor has said anything", () => {
    const down = floorState({ up: false });
    delete down.port;
    delete down.pathSecret;
    expect(freewayServeSpec({ state: down, linkedLogin: LOGIN })).toBeNull();
    expect(freewayServeSpec({ state: floorState(), linkedLogin: null })).toBeNull();
    expect(freewayServeSpec({ state: null, linkedLogin: LOGIN })).toBeNull();
  });

  it("says nothing until the floor has been read — then declares, and withdraws when the host goes", async () => {
    let state: FreewayState | null = null;
    const declared: Array<ServeSpec | null> = [];
    const driver = new FreewayServeDriver({
      state: () => state,
      linkedLogin: () => LOGIN,
      declare: async (spec) => {
        declared.push(spec);
        return true;
      },
    });
    // a boot that has not heard the floor yet withdraws nothing (F-H1's null would)
    await driver.refresh();
    expect(declared).toEqual([]);
    state = floorState();
    await driver.refresh();
    await driver.refresh();
    expect(declared).toEqual([freewayServeSpec({ state, linkedLogin: LOGIN })]);
    state = floorState({ revision: 2, up: false });
    delete state.port;
    delete state.pathSecret;
    await driver.refresh();
    expect(declared.at(-1)).toBeNull();
    // a new floor boot: a new secret, even on a recycled port, is a new serve
    state = floorState({ revision: 1, floorBootId: "fb-2", pathSecret: "12".repeat(32) });
    await driver.refresh();
    expect(declared.at(-1)?.pathSecret).toBe("12".repeat(32));
    expect(declared).toHaveLength(3);
  });
});
