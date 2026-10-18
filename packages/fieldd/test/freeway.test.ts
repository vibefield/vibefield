// F1 (draft/thinking-freeway.md v0.3 §3, §4.3) — fieldd's half of the freeway, held to its policy
// with a scripted floor: the declaration fieldd's roster calls for, the floor's state as fieldd
// reads it (armed once, re-armed after a refusal, a stale revision ignored, a new floor boot taken
// whole), the declaration's delivery (every connect, every change, one at a time, newest last), and
// the serve — the floor-held listener's door, gated on the linked login, and silent until the floor
// has been read, so a restarted fieldd withdraws nothing it has not seen (FW-L10) — the joins,
// written in the floor's order, each once, and acknowledged only through what was written (FW-L3),
// and the phone's approval: its refusals in the order a caller hears them, and the MAC the fixture
// vector pins.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  approvalSigningInput,
  type CallerContext,
  FREEWAY,
  FREEWAY_APPROVAL,
  FreewayApproveResult,
  FreewayDeclareParams,
  type FreewayJoinRow,
  type FreewayState,
  PORTS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import {
  FREEWAY_SERVE_ID,
  type FreewayApprovalRoster,
  FreewayApprover,
  FreewayFloor,
  type FreewayJoinsAudit,
  type FreewayNative,
  type FreewayRoster,
  FreewayServeDriver,
  freewayDeclaration,
  freewayServeSpec,
} from "../src/freeway";
import type { ServeSpec } from "../src/mesh-client";
import { RpcCallError } from "../src/native-link";
import { captureLog } from "./peer-roster";

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
  readonly acks: unknown[] = [];
  revokes = 0;
  refuseRevoke = false;
  /** the state stream's: how often it was asked, whether it refuses, its frames, its ends */
  subscribes = 0;
  refuseSubscribe = false;
  refuseDeclare = false;
  /** while set, a declaration waits for it before the floor answers */
  hold: Promise<void> | null = null;
  snapshot: unknown = floorState();
  push: ((payload: unknown) => void) | null = null;
  disposed = 0;
  /** the joins stream's, the same four */
  joinSubscribes = 0;
  joinsSnapshot: unknown = { floorBootId: "fb-1", rows: [], dropped: 0 };
  pushJoins: ((payload: unknown) => void) | null = null;
  joinsDisposed = 0;

  /** acknowledgments the floor refuses, after recording them */
  refuseAcks = 0;

  async request(method: string, params: unknown): Promise<unknown> {
    if (method === "native.freeway.joins.ack") {
      this.acks.push(params);
      if (this.refuseAcks > 0) {
        this.refuseAcks -= 1;
        throw new Error("the floor went away");
      }
      return {};
    }
    if (method === "native.freeway.revoke") {
      this.revokes += 1;
      if (this.refuseRevoke) throw new Error("the host did not answer");
      return { closed: 0 };
    }
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
    if (method === "native.freeway.joins.subscribe") {
      this.joinSubscribes += 1;
      await Promise.resolve();
      this.pushJoins = (payload) => onEvent(payload, "delta");
      return { snapshot: this.joinsSnapshot, dispose: () => (this.joinsDisposed += 1) };
    }
    expect(method).toBe("native.freeway.state.subscribe");
    this.subscribes += 1;
    await Promise.resolve();
    if (this.refuseSubscribe) throw new Error("METHOD_NOT_FOUND");
    this.push = (payload) => onEvent(payload, "delta");
    return { snapshot: this.snapshot, dispose: () => (this.disposed += 1) };
  }
}

/** The audit's writer, scripted: each row it took, as `[floorBootId, cursor]` (a loss as
 * `[floorBootId, {dropped, malformed}]`); the writes its ledger refuses, once each; a write held. */
class ScriptedAudit implements FreewayJoinsAudit {
  readonly written: unknown[] = [];
  /** cursors whose write is refused, and `"lost"` for the loss's */
  readonly refuse = new Set<number | "lost">();
  /** while set, a row's write waits for it before the ledger answers */
  hold: Promise<void> | null = null;

  async join(floorBootId: string, row: FreewayJoinRow): Promise<void> {
    await (this.hold ?? Promise.resolve());
    if (this.refuse.delete(row.cursor)) throw new Error("the ledger is full");
    this.written.push([floorBootId, row.cursor]);
  }

  async lost(floorBootId: string, lost: { dropped: number; malformed: number }): Promise<void> {
    await Promise.resolve();
    if (this.refuse.delete("lost")) throw new Error("the ledger is full");
    this.written.push([floorBootId, lost]);
  }
}

/** Every write and acknowledgment the frames so far set going has landed: they ride promises
 * alone, and a macrotask runs only once those are done. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

function rig(over: { terminals?: boolean; logger?: Logger } = {}) {
  const native = new ScriptedFloor();
  const audit = new ScriptedAudit();
  const people = roster();
  const floor = new FreewayFloor({
    native,
    declaration: () => freewayDeclaration(people.view, over.terminals ?? true),
    audit,
    ...(over.logger !== undefined ? { logger: over.logger } : {}),
  });
  const heard: FreewayState[] = [];
  floor.on("state", (state: FreewayState) => heard.push(state));
  return { native, audit, people, floor, heard };
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

describe("F1 — the joins, the links and the revoke", () => {
  const join = (kind: "joined" | "left", sessionId: string, at: number, cursor: number) => ({
    kind,
    clientId: `freeway:${LOGIN}#nPHONE01~hb-1`,
    sessionId,
    rights: ["geometry", "input", "read"],
    at,
    cursor,
  });
  const frame = (floorBootId: string, rows: unknown[], dropped: number) => ({
    floorBootId,
    rows,
    dropped,
  });

  it("writes each row once by its cursor, then the loss's growth and what did not parse, and acknowledges what it wrote", async () => {
    const { native, audit, floor } = rig();
    native.joinsSnapshot = frame(
      "fb-1",
      [join("joined", "s-1", 1, 1), { kind: "joined", cursor: 2 }],
      3,
    );
    await floor.connected();
    await settled();
    // the row, then the loss: 3 the floor could not hold, 1 that did not parse — acknowledged past
    expect(audit.written).toEqual([
      ["fb-1", 1],
      ["fb-1", { dropped: 3, malformed: 1 }],
    ]);
    expect(native.acks).toEqual([{ through: 2 }]);
    native.pushJoins?.(frame("fb-1", [], 3)); // the same total: nothing new to say
    native.pushJoins?.(frame("fb-1", [join("left", "s-1", 2, 3)], 3));
    native.pushJoins?.({ n: 0 }); // a floor that predates the stream: not a frame
    await settled();
    // a replay of what was never acknowledged: only the new row, and the total's growth
    native.pushJoins?.(
      frame(
        "fb-1",
        [join("joined", "s-1", 1, 1), join("left", "s-1", 2, 3), join("joined", "s-2", 4, 4)],
        5,
      ),
    );
    await settled();
    // a new floor boot: its cursors start again, and its acknowledgment is its own
    native.pushJoins?.(frame("fb-2", [join("joined", "s-3", 5, 1)], 0));
    await settled();
    expect(audit.written).toEqual([
      ["fb-1", 1],
      ["fb-1", { dropped: 3, malformed: 1 }],
      ["fb-1", 3],
      ["fb-1", 4],
      ["fb-1", { dropped: 2, malformed: 0 }],
      ["fb-2", 1],
    ]);
    expect(native.acks).toEqual([{ through: 2 }, { through: 3 }, { through: 4 }, { through: 1 }]);
    await floor.connected();
    expect(native.joinSubscribes).toBe(1);
    floor.dispose();
    expect(native.joinsDisposed).toBe(1);
    // a frame that still arrives is neither written nor acknowledged
    native.pushJoins?.(frame("fb-2", [join("left", "s-3", 6, 2)], 0));
    await settled();
    expect(audit.written).toHaveLength(6);
    expect(native.acks).toHaveLength(4);
  });

  it("a write the ledger refuses stops the line there — nothing behind it acknowledged — and the next frame writes on from it, each row once", async () => {
    const log = captureLog();
    const { native, audit, floor } = rig({ logger: log.logger });
    native.joinsSnapshot = frame(
      "fb-1",
      [join("joined", "s-1", 1, 1), join("joined", "s-2", 2, 2), join("left", "s-1", 3, 3)],
      1,
    );
    audit.refuse.add(2);
    await floor.connected();
    await settled();
    expect(audit.written).toEqual([["fb-1", 1]]);
    expect(native.acks).toEqual([]);
    expect(log.events("fieldd.freeway.joins_unaudited")).toHaveLength(1);
    // the reconnect's replay takes nothing new, and the line writes on from 2 — never 1 again
    native.pushJoins?.(native.joinsSnapshot);
    await settled();
    expect(audit.written).toEqual([
      ["fb-1", 1],
      ["fb-1", 2],
      ["fb-1", 3],
      ["fb-1", { dropped: 1, malformed: 0 }],
    ]);
    expect(native.acks).toEqual([{ through: 3 }]);
    // an acknowledgment the floor did not take is said again by the next frame
    native.refuseAcks = 1;
    native.pushJoins?.(frame("fb-1", [join("joined", "s-3", 4, 4)], 1));
    await settled();
    native.pushJoins?.(frame("fb-1", [join("joined", "s-3", 4, 4)], 1));
    await settled();
    expect(audit.written).toHaveLength(5);
    expect(native.acks).toEqual([{ through: 3 }, { through: 4 }, { through: 4 }]);
    expect(log.events("fieldd.freeway.joins_ack_deferred")).toHaveLength(1);
  });

  it("frames that arrive while a row is written are that pass's: in order, behind it as one, acknowledged once", async () => {
    const { native, audit, floor } = rig();
    native.joinsSnapshot = frame("fb-1", [join("joined", "s-1", 1, 1)], 0);
    let release = () => {};
    audit.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await floor.connected();
    native.pushJoins?.(frame("fb-1", [join("joined", "s-2", 2, 2)], 0));
    native.pushJoins?.(frame("fb-1", [join("left", "s-1", 3, 3)], 1));
    native.pushJoins?.(frame("fb-1", [join("left", "s-2", 4, 4)], 1));
    await settled();
    expect(audit.written).toEqual([]);
    audit.hold = null;
    release();
    await settled();
    // the three behind the head are one frame, its loss after its rows
    expect(audit.written).toEqual([
      ["fb-1", 1],
      ["fb-1", 2],
      ["fb-1", 3],
      ["fb-1", 4],
      ["fb-1", { dropped: 1, malformed: 0 }],
    ]);
    expect(native.acks).toEqual([{ through: 4 }]);
  });

  it("logs each link that changed — the device and its state, never a secret", async () => {
    const log = captureLog();
    const { native, floor } = rig({ logger: log.logger });
    await floor.connected();
    native.push?.(floorState({ revision: 2, links: [{ deviceId: "dev-p", state: "up" }] }));
    native.push?.(floorState({ revision: 3, links: [{ deviceId: "dev-p", state: "up" }] }));
    native.push?.(floorState({ revision: 4, links: [] }));
    native.push?.(floorState({ revision: 5, links: [{ deviceId: "dev-p", state: "up" }] }));
    // a new floor boot: the old one's links ended with it, and its own are new
    const reborn = floorState({ revision: 1, floorBootId: "fb-2" });
    native.push?.({ ...reborn, links: [{ deviceId: "dev-p", state: "up" }] });
    expect(log.events("fieldd.freeway.link")).toEqual([
      { deviceId: "dev-p", state: "up" },
      { deviceId: "dev-p", state: "down" },
      { deviceId: "dev-p", state: "up" },
      { deviceId: "dev-p", state: "down" },
      { deviceId: "dev-p", state: "up" },
    ]);
    const said = JSON.stringify(log.events("fieldd.freeway.link"));
    for (const secret of [SECRET, "ef".repeat(32), "cd".repeat(32)])
      expect(said).not.toContain(secret);
  });

  it("ends a stream that finishes arming after dispose, unheard", async () => {
    const { native, floor } = rig();
    const connecting = floor.connected();
    floor.dispose();
    await connecting;
    expect([native.disposed, native.joinsDisposed]).toEqual([1, 1]);
    expect(floor.state()).toBeNull();
  });

  it("revokes once when asked, and owes a refused revoke to the host it was meant for — never to the next one", async () => {
    const { native, floor } = rig();
    await floor.connected();
    await floor.revokeAll();
    expect(native.revokes).toBe(1);
    await floor.connected();
    expect(native.revokes).toBe(1); // answered: nothing owed
    native.refuseRevoke = true;
    await floor.revokeAll();
    native.refuseRevoke = false;
    await floor.connected(); // the same host is up: said again
    expect(native.revokes).toBe(3);
    await floor.connected();
    expect(native.revokes).toBe(3);
    native.refuseRevoke = true;
    await floor.revokeAll();
    native.refuseRevoke = false;
    // a relink brought a new host: its links are not the ones the revoke was for
    native.push?.(floorState({ revision: 2, hostBootId: "hb-2" }));
    await floor.connected();
    expect(native.revokes).toBe(4);
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

const VECTOR = JSON.parse(
  readFileSync(
    new URL("../../contracts/fixtures/freeway-approval-mac.vector.json", import.meta.url),
    "utf8",
  ),
) as {
  keyHex: string;
  approval: {
    protected: { kid: { floorBootId: string; keyGeneration: number } };
    claims: {
      principal: { login: string; tailscaleId: string };
      rights: Array<"geometry" | "input" | "read">;
      issuedAt: number;
      expiresAt: number;
      nonce: string;
    };
    mac: string;
    signingInput: string;
  };
};

const PHONE_NODE = "nPHONE01";
const ROWS: Record<
  string,
  { node: string; row: { self: boolean; capabilities?: { docHost?: boolean } } }
> = {
  "dev-phone": { node: PHONE_NODE, row: { self: false } },
  "dev-desk-b": { node: "nDESK01", row: { self: false, capabilities: { docHost: true } } },
  "dev-a": { node: "nSELF01", row: { self: true, capabilities: { docHost: true } } },
};
const ROSTER: FreewayApprovalRoster = {
  deviceIdByNodeId: (node) => Object.keys(ROWS).find((deviceId) => ROWS[deviceId]?.node === node),
  get: (deviceId) => ROWS[deviceId]?.row,
};

function caller(principal: CallerContext["principal"]): CallerContext {
  return { principal, transport: "ws-tailnet", receivedAt: 0 };
}
const fromPhone = (node = PHONE_NODE) =>
  caller({ kind: "tailnet", login: LOGIN, self: true, tailscaleId: node });

/** The refusal a call answers with: its kind, whether it may be retried, and its state. */
function refusal(call: () => unknown): { kind: string; retryable: boolean; state?: unknown } {
  try {
    call();
  } catch (error) {
    if (!(error instanceof RpcCallError)) throw error;
    const state = (error.details as { state?: unknown } | undefined)?.state;
    return {
      kind: error.kind,
      retryable: error.retryable,
      ...(state !== undefined ? { state } : {}),
    };
  }
  throw new Error("expected a refusal");
}

describe("F1 — the phone's approval (`freeway.approve`)", () => {
  it("mints exactly the bytes the fixture vector pins — the MAC the host's verifier recomputes", () => {
    const { approval } = VECTOR;
    const approver = new FreewayApprover({
      state: () =>
        floorState({
          floorBootId: approval.protected.kid.floorBootId,
          keyGeneration: approval.protected.kid.keyGeneration,
          freewayKeyHex: VECTOR.keyHex,
        }),
      roster: ROSTER,
      now: () => approval.claims.issuedAt,
      ttlMs: approval.claims.expiresAt - approval.claims.issuedAt,
      nonce: () => approval.claims.nonce,
    });
    const minted = approver.mint({
      deviceId: "dev-phone",
      login: approval.claims.principal.login,
      tailscaleId: approval.claims.principal.tailscaleId,
      rights: approval.claims.rights,
    });
    const { signingInput, ...envelope } = approval;
    expect(approvalSigningInput(minted.approval.protected, minted.approval.claims)).toBe(
      signingInput,
    );
    expect(minted.approval).toEqual(envelope);
    expect(minted.expiresAt).toBe(approval.claims.expiresAt);
    expect(FreewayApproveResult.parse(minted)).toEqual(minted);
  });

  it("gives a phone every self right under the floor boot's key, a fresh nonce each time, for the approval's life", () => {
    const approver = new FreewayApprover({
      state: () => floorState(),
      roster: ROSTER,
      now: () => 5_000,
    });
    const ask = approver.check(fromPhone(), {});
    expect(ask).toEqual({
      deviceId: "dev-phone",
      login: LOGIN,
      tailscaleId: PHONE_NODE,
      rights: ["geometry", "input", "read"],
    });
    const one = approver.mint(ask);
    const two = approver.mint(ask);
    expect(one.approval.claims.nonce).not.toBe(two.approval.claims.nonce);
    expect(one.approval.protected.kid).toEqual({ floorBootId: "fb-1", keyGeneration: 1 });
    expect(one.approval.claims).toMatchObject({
      audienceFloorBootId: "fb-1",
      clientId: `freeway:${LOGIN}#${PHONE_NODE}`,
      principal: { kind: "tailnet", login: LOGIN, tailscaleId: PHONE_NODE },
      issuedAt: 5_000,
      expiresAt: 5_000 + FREEWAY.APPROVAL_TTL_MS,
    });
    const mac = createHmac("sha256", Buffer.from("ef".repeat(32), "hex"))
      .update(approvalSigningInput(one.approval.protected, one.approval.claims), "utf8")
      .digest("base64url");
    expect(one.approval.mac).toBe(mac);
  });

  it("refuses in the order a caller hears them, and the mint reads the host's life again", () => {
    let state: FreewayState | null = floorState();
    const approver = new FreewayApprover({ state: () => state, roster: ROSTER });
    expect(refusal(() => approver.check(fromPhone(), "approve me"))).toEqual({
      kind: "PRECONDITION_FAILED",
      retryable: false,
    });
    expect(
      refusal(() => approver.check(caller({ kind: "peer-fieldd", deviceId: "dev-desk-b" }), {})),
    ).toEqual({
      kind: "UNAVAILABLE",
      retryable: false,
      state: FREEWAY_APPROVAL.STATE_FORWARDING_UNBUILT,
    });
    const window = caller({ kind: "local-token", tokenId: "t", scopes: ["terminal.attach"] });
    expect(refusal(() => approver.check(window, {})).kind).toBe("FORBIDDEN_SCOPE");
    const notSelf = caller({ kind: "tailnet", login: LOGIN, tailscaleId: PHONE_NODE });
    expect(refusal(() => approver.check(notSelf, {})).kind).toBe("FORBIDDEN_SCOPE");
    const noNode = caller({ kind: "tailnet", login: LOGIN, self: true });
    expect(refusal(() => approver.check(noNode, {}))).toEqual({
      kind: "PRECONDITION_FAILED",
      retryable: false,
    });
    expect(refusal(() => approver.check(fromPhone("nSTRANGER"), {}))).toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      state: FREEWAY_APPROVAL.STATE_UNCORRELATED,
    });
    expect(refusal(() => approver.check(fromPhone("nDESK01"), {})).kind).toBe("FORBIDDEN_SCOPE");
    expect(refusal(() => approver.check(fromPhone("nSELF01"), {})).kind).toBe("FORBIDDEN_SCOPE");
    state = null;
    expect(refusal(() => approver.check(fromPhone(), {}))).toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      state: FREEWAY_APPROVAL.STATE_UNREAD,
    });
    state = floorState();
    const ask = approver.check(fromPhone(), {});
    state = floorState({ revision: 2, up: false });
    delete state.freewayKeyHex;
    expect(refusal(() => approver.mint(ask))).toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      state: FREEWAY_APPROVAL.STATE_DOWN,
    });
  });
});
