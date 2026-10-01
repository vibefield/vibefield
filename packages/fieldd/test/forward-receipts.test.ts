// DS-2 (DS-D15, 2026-09-30) — receipts for forwarded mutations. The two
// journals directly (owner: applied once per {peer, key}, a retry reads the
// outcome; caller: in flight / applied / refused / outcome-unknown), then a
// REAL PeerLink against a scripted peer door, which is how the caller half
// learns whether a forward left, was answered, or lost its answer.
import { FORWARDING, IdempotencyKey, TERMINAL_PIPELINE } from "@vibefield/contracts";
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

  // S5 (the landing review, 2026-10-01) — a retryable refusal applied nothing
  // and says asking again may work; journaled, the same-key retry read it for
  // RECEIPT_TTL_MS. It leaves no receipt now.
  it("a RETRYABLE refusal leaves no receipt: the same-key retry executes again, and can apply", async () => {
    const { journal } = ownerJournal();
    let tries = 0;
    const act = async () => {
      tries += 1;
      if (tries === 1)
        throw new RpcCallError("UNAVAILABLE", "the agent runtime is starting", true, {
          service: "agents",
          state: "starting",
        });
      return { accepted: true, n: tries };
    };
    await expect(journal.run(call(), act)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
    });
    expect(journal.receipt("dev-a", KEY)).toBeUndefined();
    expect(journal.size()).toBe(0);
    // the retry RUNS (it is not answered from a stale refusal) and applies once
    expect(await journal.run(call(), act)).toEqual({ accepted: true, n: 2 });
    expect(await journal.run(call(), act)).toEqual({ accepted: true, n: 2 });
    expect(tries).toBe(2);
    expect(journal.receipt("dev-a", KEY)).toMatchObject({ state: "applied" });
  });

  it("a NON-retryable refusal is still journaled and replayed without executing", async () => {
    const { journal } = ownerJournal();
    let tries = 0;
    const act = async () => {
      tries += 1;
      throw new RpcCallError("PRECONDITION_FAILED", "the run already exited", false, {
        runtimeRunId: "run-1",
      });
    };
    await expect(journal.run(call(), act)).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    await expect(journal.run(call(), act)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      retryable: false,
    });
    expect(tries).toBe(1);
    expect(journal.receipt("dev-a", KEY)).toMatchObject({
      state: "refused",
      error: "PRECONDITION_FAILED",
    });
  });

  it("an arrival waiting on a retryable refusal answers THAT refusal — one execution, never two in parallel", async () => {
    const { journal } = ownerJournal();
    let tries = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const act = async () => {
      tries += 1;
      await gate;
      throw new RpcCallError("UNAVAILABLE", "the agent runtime is starting", true, {
        service: "agents",
        state: "starting",
      });
    };
    const first = journal.run(call(), act);
    const second = journal.run(call(), act); // the duplicate, while the first runs
    release();
    await expect(first).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    await expect(second).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "agents", state: "starting" },
    });
    expect(tries).toBe(1);
    // …and with both answered, nothing is left to replay
    expect(journal.receipt("dev-a", KEY)).toBeUndefined();
    expect(journal.size()).toBe(0);
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

  it("the result cap is the registry's (FORWARDING.RESULT_CAP_BYTES): an answer one byte over it is journaled as a receipt", async () => {
    const { journal } = ownerJournal(); // the default cap, not a test's own
    // `{"blob":"…"}` is 11 bytes of JSON around the blob
    const blob = "x".repeat(FORWARDING.RESULT_CAP_BYTES - 11 + 1);
    let applied = 0;
    const big = async () => {
      applied += 1;
      return { blob };
    };
    await journal.run(call(), big);
    expect(await journal.run(call(), big)).toMatchObject({ state: "applied", resultOmitted: true });
    expect(applied).toBe(1);
  });

  // DS-2b (2026-10-01; the review's DS-2 list) — keyed results replayed for
  // RECEIPT_TTL_MS (a day), tickets included: a forwarded `terminal.openTicket`
  // is a keyed mutation and its transport grant lives a minute, so a retry
  // past that replayed a ticket the cell refuses to dial.
  it("a ticket mint is never journaled: its same-key retry mints afresh — a replayed ticket is a refused dial", async () => {
    const { journal } = ownerJournal();
    let minted = 0;
    const mint = async () => {
      minted += 1;
      return { transportGrant: { claims: { expiresAt: 61_000, nonce: `n-${minted}` } } };
    };
    const ticket = call({
      method: "terminal.openTicket",
      digest: forwardDigest({ sessionId: "s" }),
    });
    const first = await journal.run(ticket, mint);
    const retry = await journal.run(ticket, mint);
    expect(minted).toBe(2);
    expect(retry).not.toEqual(first);
    expect(journal.receipt("dev-a", KEY)).toBeUndefined();
    expect(journal.size()).toBe(0);
  });

  it("an answer carrying a transport grant replays only while the grant lives — past its own expiry the retry answers the receipt, never the stale ticket, and the act never runs twice", async () => {
    const { journal, tick } = ownerJournal(); // the journal's clock starts at 1_000
    let born = 0;
    const birth = async () => {
      born += 1;
      return {
        session: { runtimeRunId: "run-1" },
        terminal: { sessionId: "pane-1", transportGrant: { claims: { expiresAt: 61_000 } } },
      };
    };
    const spawn = call({ method: "agent.spawn", digest: forwardDigest({ provider: "scripted" }) });
    const first = await journal.run(spawn, birth);
    tick(59_999); // 60_999: the grant still lives — the same answer
    expect(await journal.run(spawn, birth)).toEqual(first);
    tick(1); // 61_000: it does not
    const late = await journal.run(spawn, birth);
    expect(late).toMatchObject({
      idempotencyKey: KEY,
      method: "agent.spawn",
      state: "applied",
      resultOmitted: true,
      resultExpired: true,
    });
    expect(JSON.stringify(late)).not.toContain("transportGrant");
    expect(await journal.run(spawn, birth)).toMatchObject({ resultExpired: true }); // and stays so
    expect(born).toBe(1);
  });

  it("a grant whose expiry cannot be read counts the registry's grant life from when the act applied", async () => {
    const { journal, tick } = ownerJournal();
    let born = 0;
    const birth = async () => {
      born += 1;
      return { session: { runtimeRunId: "run-2" }, terminal: { transportGrant: {} } };
    };
    const spawn = call({ method: "agent.resume", digest: forwardDigest({ runtimeRunId: "r" }) });
    const first = await journal.run(spawn, birth);
    tick(TERMINAL_PIPELINE.TRANSPORT_GRANT_TTL_MS - 1);
    expect(await journal.run(spawn, birth)).toEqual(first);
    tick(1);
    expect(await journal.run(spawn, birth)).toMatchObject({ resultExpired: true });
    expect(born).toBe(1);
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

// A generous default: on a loaded host a DIAL can outlast a short deadline, and
// a forward that never left is (rightly) not an unknown. Rows that time out on
// purpose warm the link first and pass their own.
function linkTo(url: string | undefined, forwardTimeoutMs = 4_000): PeerLink {
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
    let asked = 0;
    const door = await scriptedDoor((msg, ws) => {
      if (msg.method !== "agent.interrupt") return answer(ws, msg.id, { devices: [] });
      asked += 1;
      if (asked >= 2) answer(ws, msg.id, { accepted: true }); // the first is never answered
    });
    const link = linkTo(door.url, 1_000);
    // the link is READY before the keyed forward, so its deadline measures the
    // missing answer and never the dial
    await link.request("dev-b", "device.list", {});
    const cut = await link
      .request("dev-b", "agent.interrupt", RUN, { onBehalfOf: behalf, idempotencyKey: KEY })
      .catch((e: unknown) => e);
    expect(cut).toBeInstanceOf(RpcCallError);
    expect(cut).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: {
        service: "peer-link", // UnavailableDetails requires it (2026-10-01)
        device: "dev-b",
        state: "outcome-unknown",
        idempotencyKey: KEY,
      },
    });
    expect(link.receipts.get(KEY)).toMatchObject({ state: "outcome-unknown", device: "dev-b" });

    // DS-2b (2026-10-01) — the deadline was the CALL's: the link stayed up
    // (the door answered the liveness probe the deadline sent), and the retry
    // rides the same socket — it used to drop the link and re-dial here
    expect(link.linkState("dev-b")).toBe("connected");
    await link.request("dev-b", "device.list", {});
    const retried = await link.request("dev-b", "agent.interrupt", RUN, {
      onBehalfOf: behalf,
      idempotencyKey: KEY,
    });
    expect(retried).toEqual({ accepted: true });
    expect(link.receipts.get(KEY)).toMatchObject({ state: "applied" });
    // both attempts carried the SAME key and who they were for, beside the params
    expect(door.seen.filter((s) => s.method === "agent.interrupt").map((s) => s.params)).toEqual([
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
