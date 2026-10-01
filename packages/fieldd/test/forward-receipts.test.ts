// DS-2 (DS-D15, 2026-09-30) — receipts for forwarded mutations. The two
// journals directly (owner: applied once per {peer, key}, a retry reads the
// outcome; caller: in flight / applied / refused / outcome-unknown), then a
// REAL PeerLink against a scripted peer door, which is how the caller half
// learns whether a forward left, was answered, or lost its answer.
import { IdempotencyKey } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  CallerForwardJournal,
  forwardDigest,
  mintForwardKey,
  OwnerForwardJournal,
} from "../src/forward-receipts";
import { RpcCallError } from "../src/native-link";
import { PeerLink } from "../src/peer-link";
import { answer, scriptedDoor as openDoor, refuse, type ScriptedDoor } from "./scripted-door";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const KEY = "fk_retry_key_0001";
const RUN = { runtimeRunId: "run-1" };

function ownerJournal(opts: { depth?: number; ttlMs?: number; resultBytes?: number } = {}) {
  let now = 1_000;
  const journal = new OwnerForwardJournal({ device: () => "dev-owner", now: () => now, ...opts });
  return {
    journal,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const call = (over: Partial<Parameters<OwnerForwardJournal["run"]>[0]> = {}) => ({
  peer: "dev-a",
  key: KEY,
  method: "agent.interrupt",
  digest: forwardDigest(RUN),
  ...over,
});

describe("the key's bindings", () => {
  it("a minted key is a contract key, and fresh each time", () => {
    const a = mintForwardKey();
    expect(IdempotencyKey.safeParse(a).success).toBe(true);
    expect(mintForwardKey()).not.toBe(a);
  });

  it("the digest binds the method's OWN params: routing, the envelope and key order do not move it", () => {
    const base = forwardDigest({ runtimeRunId: "run-1", nested: { b: 2, a: 1 } });
    expect(
      forwardDigest({
        nested: { a: 1, b: 2 },
        device: "dev-b",
        forward: { onBehalfOf: { clientKind: "renderer", deviceId: "dev-a" }, idempotencyKey: KEY },
        runtimeRunId: "run-1",
      }),
    ).toBe(base);
    expect(forwardDigest({ runtimeRunId: "run-2", nested: { a: 1, b: 2 } })).not.toBe(base);
    // a method's OWN idempotencyKey param is part of the call it names
    expect(
      forwardDigest({ runtimeRunId: "run-1", nested: { a: 1, b: 2 }, idempotencyKey: "own" }),
    ).not.toBe(base);
  });
});

describe("the owner's journal", () => {
  it("executes a key once; the retry is answered from the receipt", async () => {
    const { journal } = ownerJournal();
    let applied = 0;
    const act = async () => {
      applied += 1;
      return { accepted: true, n: applied };
    };
    expect(await journal.run(call(), act)).toEqual({ accepted: true, n: 1 });
    expect(await journal.run(call(), act)).toEqual({ accepted: true, n: 1 });
    expect(applied).toBe(1);
    expect(journal.receipt("dev-a", KEY)).toMatchObject({
      idempotencyKey: KEY,
      method: "agent.interrupt",
      device: "dev-owner",
      state: "applied",
    });
  });

  it("an arrival while the first is still running waits for it and answers its outcome", async () => {
    const { journal } = ownerJournal();
    let applied = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = journal.run(call(), async () => {
      applied += 1;
      await gate;
      return { accepted: true };
    });
    const second = journal.run(call(), async () => {
      applied += 1;
      return { accepted: false };
    });
    release();
    expect(await first).toEqual({ accepted: true });
    expect(await second).toEqual({ accepted: true });
    expect(applied).toBe(1);
  });

  it("a refusal is journaled: the retry is refused the same way without executing", async () => {
    const { journal } = ownerJournal();
    let tries = 0;
    const refuse = async () => {
      tries += 1;
      throw new RpcCallError("NOT_FOUND", "no such run", false, { runtimeRunId: "run-1" });
    };
    await expect(journal.run(call(), refuse)).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(journal.run(call(), refuse)).rejects.toMatchObject({
      kind: "NOT_FOUND",
      message: "no such run",
      details: { runtimeRunId: "run-1" },
    });
    expect(tries).toBe(1);
    expect(journal.receipt("dev-a", KEY)).toMatchObject({ state: "refused", error: "NOT_FOUND" });
  });

  it("a key reused for a different call is refused and never answered with the other call's outcome", async () => {
    const { journal } = ownerJournal();
    await journal.run(call(), async () => ({ accepted: true }));
    let ran = false;
    const other = async () => {
      ran = true;
      return {};
    };
    await expect(journal.run(call({ method: "agent.spawn" }), other)).rejects.toMatchObject({
      kind: "CONFLICT",
    });
    await expect(
      journal.run(call({ digest: forwardDigest({ runtimeRunId: "run-2" }) }), other),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    expect(ran).toBe(false);
  });

  it("keys are per calling peer", async () => {
    const { journal } = ownerJournal();
    let applied = 0;
    const act = async () => ({ n: ++applied });
    await journal.run(call({ peer: "dev-a" }), act);
    await journal.run(call({ peer: "dev-c" }), act);
    expect(applied).toBe(2);
  });

  it("a result over the cap is journaled as a receipt, and its retry answers that receipt", async () => {
    const { journal } = ownerJournal({ resultBytes: 32 });
    let applied = 0;
    const big = async () => {
      applied += 1;
      return { blob: "x".repeat(100) };
    };
    expect(await journal.run(call(), big)).toEqual({ blob: "x".repeat(100) });
    expect(await journal.run(call(), big)).toMatchObject({
      idempotencyKey: KEY,
      state: "applied",
      resultOmitted: true,
    });
    expect(applied).toBe(1);
  });

  it("is bounded: receipts expire after the TTL and the oldest settle out past the depth", async () => {
    const { journal, tick } = ownerJournal({ depth: 2, ttlMs: 1_000 });
    for (const key of ["fk_depth_key_1", "fk_depth_key_2", "fk_depth_key_3"])
      await journal.run(call({ key }), async () => ({ key }));
    expect(journal.receipt("dev-a", "fk_depth_key_1")).toBeUndefined();
    expect(journal.receipt("dev-a", "fk_depth_key_3")).toBeDefined();
    tick(1_001);
    expect(journal.receipt("dev-a", "fk_depth_key_3")).toBeUndefined();
    expect(journal.size()).toBe(0);
  });
});

describe("the caller's journal", () => {
  const forward = { device: "dev-b", method: "agent.interrupt", digest: forwardDigest(RUN) };

  it("sent then lost reads outcome-unknown; the retry's answer resolves it", () => {
    const journal = new CallerForwardJournal();
    const first = journal.begin(KEY, forward);
    first.sent();
    expect(journal.get(KEY)).toMatchObject({ state: "outcome-unknown", inFlight: true });
    first.lost();
    expect(journal.get(KEY)).toMatchObject({ state: "outcome-unknown", device: "dev-b" });
    expect(journal.get(KEY)?.inFlight).toBeUndefined();
    const retry = journal.begin(KEY, forward);
    retry.sent();
    retry.applied();
    expect(journal.get(KEY)).toMatchObject({ state: "applied" });
  });

  it("an attempt that never left is forgotten — unless an earlier one DID leave", () => {
    const journal = new CallerForwardJournal();
    journal.begin(KEY, forward).unsent();
    expect(journal.get(KEY)).toBeUndefined();

    const lost = journal.begin(KEY, forward);
    lost.sent();
    lost.lost();
    // the retry fails before it leaves: the first one's outcome is still unknown
    journal.begin(KEY, forward).unsent();
    expect(journal.get(KEY)).toMatchObject({ state: "outcome-unknown" });
  });

  it("an answered attempt is not overturned by an overlapping one that lost its answer", () => {
    const journal = new CallerForwardJournal();
    const a = journal.begin(KEY, forward);
    const b = journal.begin(KEY, forward);
    a.sent();
    b.sent();
    b.applied();
    a.lost();
    expect(journal.get(KEY)).toMatchObject({ state: "applied" });
  });

  it("the owner's refusal is recorded with its kind", () => {
    const journal = new CallerForwardJournal();
    const attempt = journal.begin(KEY, forward);
    attempt.sent();
    attempt.refused("FORBIDDEN_SCOPE");
    expect(journal.get(KEY)).toMatchObject({ state: "refused", error: "FORBIDDEN_SCOPE" });
  });

  it("a key journaled for one call cannot start another", () => {
    const journal = new CallerForwardJournal();
    journal.begin(KEY, forward).unsent();
    const sent = journal.begin(KEY, forward);
    sent.sent();
    sent.lost();
    expect(() =>
      journal.begin(KEY, { ...forward, digest: forwardDigest({ runtimeRunId: "run-2" }) }),
    ).toThrow(/reused for a different call/);
    expect(() => journal.begin(KEY, { ...forward, device: "dev-c" })).toThrow(RpcCallError);
  });
});

async function scriptedDoor(
  script: Parameters<typeof openDoor>[0],
  opts?: Parameters<typeof openDoor>[1],
): Promise<ScriptedDoor> {
  const door = await openDoor(script, opts);
  cleanup.push(() => door.close());
  return door;
}

function linkTo(url: string | undefined, forwardTimeoutMs = 250): PeerLink {
  const link = new PeerLink({
    ownDeviceId: () => "dev-a",
    endpointFor: () => url,
    webSocket: WebSocket,
    forwardTimeoutMs,
    callTimeoutMs: 2_000,
  });
  cleanup.push(() => link.dispose());
  return link;
}

const behalf = { clientKind: "renderer", deviceId: "dev-a", windowId: "window-7" };

describe("PeerLink's keyed forwards (the caller's half)", () => {
  it("no answer within the deadline reads outcome-unknown; the retry with the same key reads the owner's answer", async () => {
    const door = await scriptedDoor((msg, ws, n) => {
      if (n >= 2) answer(ws, msg.id, { accepted: true }); // the first is never answered
    });
    const link = linkTo(door.url);
    const cut = await link
      .request("dev-b", "agent.interrupt", RUN, { onBehalfOf: behalf, idempotencyKey: KEY })
      .catch((e: unknown) => e);
    expect(cut).toBeInstanceOf(RpcCallError);
    expect(cut).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { device: "dev-b", state: "outcome-unknown", idempotencyKey: KEY },
    });
    expect(link.receipts.get(KEY)).toMatchObject({ state: "outcome-unknown", device: "dev-b" });

    const retried = await link.request("dev-b", "agent.interrupt", RUN, {
      onBehalfOf: behalf,
      idempotencyKey: KEY,
    });
    expect(retried).toEqual({ accepted: true });
    expect(link.receipts.get(KEY)).toMatchObject({ state: "applied" });
    // both attempts carried the SAME key and who they were for, beside the params
    expect(door.seen.map((s) => s.params)).toEqual([
      { ...RUN, forward: { onBehalfOf: behalf, idempotencyKey: KEY } },
      { ...RUN, forward: { onBehalfOf: behalf, idempotencyKey: KEY } },
    ]);
  });

  it("a link cut mid-flight reads outcome-unknown, never a plain failure", async () => {
    const door = await scriptedDoor((_msg, ws) => ws.terminate());
    const link = linkTo(door.url, 5_000);
    await expect(
      link.request("dev-b", "agent.interrupt", RUN, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({ details: { state: "outcome-unknown", idempotencyKey: KEY } });
    expect(link.receipts.get(KEY)?.state).toBe("outcome-unknown");
  });

  it("the owner's own refusal is a refusal — even an UNAVAILABLE about its own dependency, which no longer drops the link", async () => {
    const door = await scriptedDoor((msg, ws) =>
      refuse(ws, msg.id, {
        code: -32006,
        message: "agent runtime starting",
        kind: "UNAVAILABLE",
        retryable: true,
        details: { service: "agents", state: "starting" },
      }),
    );
    const link = linkTo(door.url);
    await expect(
      link.request("dev-b", "agent.interrupt", RUN, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: "agent runtime starting",
      details: { service: "agents", state: "starting" },
    });
    expect(link.receipts.get(KEY)).toMatchObject({ state: "refused", error: "UNAVAILABLE" });
    expect(link.linkState("dev-b")).toBe("connected"); // the door answered; the link is fine
  });

  it("a forward that never left is forgotten and fails plainly", async () => {
    const offline = linkTo(undefined);
    await expect(
      offline.request("dev-b", "agent.interrupt", RUN, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({ details: { device: "dev-b", state: "offline" } });
    expect(offline.receipts.get(KEY)).toBeUndefined();

    // a dial that never becomes ready: the deadline passes before it could leave
    const dead = linkTo("ws://127.0.0.1:1/", 300);
    await expect(
      dead.request("dev-b", "agent.interrupt", RUN, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({ details: { state: "unreachable" } });
    expect(dead.receipts.get(KEY)).toBeUndefined();
  });

  it("a key reused for a different call is refused before it leaves", async () => {
    const door = await scriptedDoor((msg, ws) => answer(ws, msg.id, { accepted: true }));
    const link = linkTo(door.url);
    await link.request("dev-b", "agent.interrupt", RUN, { idempotencyKey: KEY });
    await expect(
      link.request("dev-b", "agent.interrupt", { runtimeRunId: "run-2" }, { idempotencyKey: KEY }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    expect(door.seen).toHaveLength(1);
  });

  it("an unkeyed call is not journaled", async () => {
    const door = await scriptedDoor((msg, ws) => answer(ws, msg.id, { devices: [] }));
    const link = linkTo(door.url);
    await link.request("dev-b", "device.list", {}, { onBehalfOf: behalf });
    expect(link.receipts.size()).toBe(0);
    expect(door.seen[0]?.params).toEqual({ forward: { onBehalfOf: behalf } });
  });
});
