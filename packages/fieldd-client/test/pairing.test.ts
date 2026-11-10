// OB custody (C2) — the shell pairs, it does not bear. Under custody's `sealed` level no shell token exists: a
// `shell-main` client is handed two functions made in Node from the pairing secret (this file stays browser-safe and
// holds no crypto). `credential()` makes the hello's `PairingMac`, fresh for each connection attempt, and `proves()`
// judges the ack's `serverMac`. A listener that takes the hello and proves nothing was told nothing it can use, and
// the client ends there: UNAUTHORIZED, its own verdict, never a reconnect loop into the same listener.
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient, FielddRpcError, type WsCtor, type WsLike } from "../src/client";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const stopAt = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > stopAt) throw new Error("condition did not become true");
    await delay(5);
  }
}

type HelloAnswer = { result: unknown } | { refused: { kind: string; message: string } };

/** A scripted door: every socket opens, each hello is recorded and answered by `answer`, and any other call is
 * answered empty. `drop()` cuts the newest socket as a daemon's restart would. */
function door(answer: (attempt: number) => HelloAnswer) {
  const hellos: Record<string, unknown>[] = [];
  const sockets: Scripted[] = [];
  class Scripted implements WsLike {
    readyState = 0;
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    constructor(_url: string) {
      sockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.emit("open", {});
      }, 0);
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as { id: number; method: string; params: unknown };
      if (msg.method !== "system.hello") {
        this.reply({ jsonrpc: "2.0", id: msg.id, result: {} });
        return;
      }
      hellos.push(msg.params as Record<string, unknown>);
      const said = answer(hellos.length);
      if ("result" in said) {
        this.reply({ jsonrpc: "2.0", id: msg.id, result: said.result });
        return;
      }
      const data = { kind: said.refused.kind, retryable: false };
      const error = { code: -32001, message: said.refused.message, data };
      this.reply({ jsonrpc: "2.0", id: msg.id, error });
    }
    close(): void {
      this.cut(1000);
    }
    cut(code: number): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setTimeout(() => this.emit("close", { code }), 0);
    }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    private reply(frame: unknown): void {
      setTimeout(() => this.emit("message", { data: JSON.stringify(frame) }), 0);
    }
    private emit(type: string, ev: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
  }
  return {
    ctor: Scripted as unknown as WsCtor,
    hellos,
    drop: () => sockets.at(-1)?.cut(1006),
  };
}

const BEARER = "a-bearer-that-is-never-sent-0123456789";

/** A pairing whose MACs are plain words, so a row can read what was asked: attempt n sends nonce `n-<n>` and is
 * proved by `ack-of-n-<n>`. */
function wordPairing() {
  const asked: Array<{ serverMac?: string }> = [];
  let attempt = 0;
  return {
    asked,
    attempts: () => attempt,
    pairing: {
      credential() {
        attempt += 1;
        return {
          bootId: "boot-1",
          ts: 1784930400,
          nonce: `n-${attempt}`,
          mac: `mac-of-n-${attempt}`,
        };
      },
      proves(ack: { serverMac?: string }) {
        asked.push(ack);
        return ack.serverMac === `ack-of-n-${attempt}`;
      },
    },
  };
}
type WordPairing = ReturnType<typeof wordPairing>["pairing"];

function clientAt(ctor: WsCtor, pairing?: WordPairing): FielddClient {
  const client = new FielddClient({
    url: "ws://127.0.0.1:49213",
    token: BEARER,
    clientKind: "shell-main",
    webSocket: ctor,
    maxBackoffMs: 10,
    ...(pairing !== undefined ? { pairing } : {}),
  });
  cleanup.push(() => client.close());
  return client;
}

const proving = (attempt: number): HelloAnswer => ({
  result: { grantedScopes: ["tokens.mint"], serverMac: `ack-of-n-${attempt}` },
});

describe("FielddClient — a shell that pairs (OB custody)", () => {
  it("sends the pairing's credential in its hello, never a token, and is ready when the ack proves it", async () => {
    const at = door(proving);
    const words = wordPairing();
    const client = clientAt(at.ctor, words.pairing);
    await client.ready();
    expect(at.hellos).toHaveLength(1);
    expect(at.hellos[0]?.["clientKind"]).toBe("shell-main");
    expect(at.hellos[0]?.["credential"]).toEqual({
      bootId: "boot-1",
      ts: 1784930400,
      nonce: "n-1",
      mac: "mac-of-n-1",
    });
    expect(JSON.stringify(at.hellos[0])).not.toContain(BEARER);
    expect(words.asked).toEqual([{ serverMac: "ack-of-n-1" }]);
    expect(client.grantedScopes).toEqual(["tokens.mint"]);
  });

  it("asks for a fresh credential at every connection attempt, and proves each ack against its own", async () => {
    const at = door(proving);
    const words = wordPairing();
    const client = clientAt(at.ctor, words.pairing);
    await client.ready();
    at.drop();
    await until(() => at.hellos.length === 2 && client.status === "ready");
    expect(words.attempts()).toBe(2);
    const nonces = at.hellos.map((hello) => (hello["credential"] as { nonce: string }).nonce);
    expect(nonces).toEqual(["n-1", "n-2"]);
    expect(words.asked).toEqual([{ serverMac: "ack-of-n-1" }, { serverMac: "ack-of-n-2" }]);
  });

  it("ends, UNAUTHORIZED, on an ack that proves nothing: the listener did not prove the pairing", async () => {
    // a listener planted at the recorded port: it takes any hello and says yes
    const at = door(() => ({ result: { grantedScopes: ["tokens.mint", "native.admin"] } }));
    const words = wordPairing();
    const client = clientAt(at.ctor, words.pairing);
    const refusal = await client.ready().then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(FielddRpcError);
    const error = refusal as FielddRpcError;
    expect(error.kind).toBe("UNAUTHORIZED");
    expect(error.message).toBe("the listener did not prove the pairing");
    // the client's own verdict, never a remote answer, and terminal: it does not dial that listener again
    expect(error.code).toBeUndefined();
    expect(client.status).toBe("failed");
    expect(client.grantedScopes).toEqual([]);
    expect(words.asked).toEqual([{}]);
    await delay(80);
    expect(at.hellos).toHaveLength(1);
  });

  it("refuses a proof for another nonce, and one that is no string", async () => {
    for (const serverMac of ["ack-of-n-7", 7, null]) {
      const at = door(() => ({ result: { grantedScopes: ["tokens.mint"], serverMac } }));
      const words = wordPairing();
      const client = clientAt(at.ctor, words.pairing);
      await expect(client.ready()).rejects.toMatchObject({ kind: "UNAUTHORIZED" });
      expect(client.status).toBe("failed");
      // what is not a string never reaches the judge as one
      expect(words.asked).toEqual([typeof serverMac === "string" ? { serverMac } : {}]);
    }
  });

  it("takes the daemon's own refusal of a pairing as it takes a bad token's: terminal", async () => {
    const at = door(() => ({ refused: { kind: "UNAUTHORIZED", message: "invalid token" } }));
    const words = wordPairing();
    const client = clientAt(at.ctor, words.pairing);
    const refusal = await client.ready().then(
      () => null,
      (error: unknown) => error,
    );
    const said = { kind: "UNAUTHORIZED", message: "invalid token", code: -32001 };
    expect(refusal).toMatchObject(said);
    expect(client.status).toBe("failed");
    // nothing was proved or judged: the daemon said no first
    expect(words.asked).toEqual([]);
  });

  it("ends rather than dial for ever when the credential cannot be made", async () => {
    const at = door(proving);
    const client = clientAt(at.ctor, {
      credential() {
        throw new Error("no secret to pair with");
      },
      proves: () => true,
    });
    await expect(client.ready()).rejects.toMatchObject({ kind: "UNAUTHORIZED" });
    expect(client.status).toBe("failed");
    expect(at.hellos).toEqual([]);
  });

  it("without a pairing sends the bearer, as it always has", async () => {
    const at = door(() => ({ result: { grantedScopes: [] } }));
    const client = clientAt(at.ctor);
    await client.ready();
    expect(at.hellos[0]?.["credential"]).toBe(BEARER);
  });
});
