import { describe, expect, it } from "vitest";
import { createKeyring, KEY_PATH_SHAPE } from "../src/main/pages/core/keys";
import type { Keyring } from "../src/main/pages/core/types";

// EY-1 (2026-11-19): one-use keys, minted when the broker arms a launch and never again at a spend,
// delivered in-process to the broker (never a file, never argv). A spent key presented again is
// `unknown-connection`, and nothing is superseded.

/** Deterministic randomness: each call returns the next counter value spread over `size` bytes. */
function counterBytes(): (size: number) => Uint8Array {
  let n = 0;
  return (size) => {
    n += 1;
    const bytes = Buffer.alloc(size);
    bytes.writeUInt32BE(n, size - 4);
    return bytes;
  };
}

function setup() {
  const delivered: Array<{ routeKey: string; url: string | null }> = [];
  let t = 1000;
  const keyring: Keyring = createKeyring({
    randomBytes: counterBytes(),
    now: () => {
      t += 1;
      return t;
    },
    deliver: (routeKey: string, url: string | null) => {
      delivered.push({ routeKey, url });
    },
  });
  /** the path of the last URL delivered: the only place a key exists */
  const lastPath = (): string => {
    const url = delivered.at(-1)?.url;
    if (typeof url !== "string") throw new Error("no URL was delivered");
    return new URL(url).pathname;
  };
  return { keyring, delivered, lastPath };
}

const refused = (claim: { ok: boolean; verdict?: { code: string } }): string | undefined =>
  claim.ok ? undefined : claim.verdict?.code;

describe("one-use keys (EY-1)", () => {
  it("mints a key only when a launch is armed, and delivers its URL", () => {
    const { keyring, delivered, lastPath } = setup();
    const route = keyring.addRoute({ routeKey: "run1", port: 4321 });
    expect(delivered).toEqual([]);
    expect(keyring.arm("run1")).toEqual({ epoch: 1 });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.routeKey).toBe("run1");
    expect(delivered[0]?.url).toBe(`ws://127.0.0.1:4321${lastPath()}`);
    expect(lastPath()).toMatch(KEY_PATH_SHAPE);
    expect(lastPath().split("/")[2]).toBe(route.routeId);
  });

  it("binds the key to the first connection; a second connection with the same URL is refused", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    const path = lastPath();
    expect(keyring.claim(path, "c1")).toEqual({ ok: true, routeKey: "run1", epoch: 1 });
    expect(refused(keyring.claim(path, "c2"))).toBe("unknown-connection");
    expect(keyring.liveConnections("run1")).toEqual([{ connId: "c1", epoch: 1 }]);
  });

  it("refuses a spent key presented again, and the ledger says so", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    const path = lastPath();
    expect(keyring.claim(path, "c1").ok).toBe(true);
    keyring.released("c1");
    expect(keyring.liveConnections("run1")).toEqual([]);
    expect(refused(keyring.claim(path, "c2"))).toBe("unknown-connection");
    expect(typeof keyring.ledger("run1")[0]?.replayedAt).toBe("number");
  });

  it("mints nothing at a spend: the next launch is armed", () => {
    const { keyring, delivered, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    keyring.claim(lastPath(), "c1");
    expect(delivered).toHaveLength(1);
    expect(keyring.ledger("run1")).toHaveLength(1);
    expect(keyring.arm("run1")).toEqual({ epoch: 2 });
    expect(delivered).toHaveLength(2);
  });

  it("keeps one unspent key per route: arming again retires the one resting", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    const first = lastPath();
    keyring.arm("run1");
    const unspent = keyring.ledger("run1").filter((row) => row.state === "unspent");
    expect(unspent.map((row) => row.epoch)).toEqual([2]);
    expect(refused(keyring.claim(first, "c1"))).toBe("unknown-connection");
    expect(keyring.claim(lastPath(), "c2").ok).toBe(true);
  });

  it("refuses missing, forged, malformed and other-route keys as unknown-connection", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    const path = lastPath();
    const [, , routeId = "", key = ""] = path.split("/");
    const candidates: unknown[] = [
      "/",
      "/browser",
      `/browser/${routeId}`,
      `/browser/${routeId}/${"0".repeat(64)}`,
      `/target/${routeId}/${key}`,
      `/ticket/${routeId}/${key}`,
      `/browser/${routeId}/${key.slice(0, -1)}A`,
      `/browser/${routeId}/${key}/x`,
      42,
    ];
    candidates.forEach((candidate, i) => {
      expect(refused(keyring.claim(candidate as string, `c-${i}`)), String(candidate)).toBe(
        "unknown-connection",
      );
    });
    expect(keyring.claim(path, "c-real").ok, "the failures spent nothing").toBe(true);
  });

  it("reads the key past a query string", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    expect(keyring.claim(`${lastPath()}?x=1`, "c1").ok).toBe(true);
  });

  it("lets one connection present one key", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    expect(keyring.claim(lastPath(), "c1").ok).toBe(true);
    keyring.arm("run1");
    expect(keyring.claim(lastPath(), "c1").ok).toBe(false);
  });

  it("refuses every key of a revoked route, spent or not, and delivers its end", () => {
    const { keyring, delivered, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    keyring.claim(lastPath(), "c1");
    keyring.arm("run1");
    const resting = lastPath();
    keyring.revoke("run1");
    expect(delivered.at(-1)).toEqual({ routeKey: "run1", url: null });
    const claim = keyring.claim(resting, "c2");
    expect(claim.ok ? "" : claim.verdict.reason).toMatch(/revoked/u);
    expect(keyring.ledger("run1").every((row) => row.revokedAt !== undefined)).toBe(true);
    // the bridge closes the route's sockets and releases them
    expect(keyring.liveConnections("run1")).toEqual([{ connId: "c1", epoch: 1 }]);
  });

  it("keeps a route key unique while live, and re-adds it after a revoke with a new route id", () => {
    const { keyring, lastPath } = setup();
    const a = keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    const old = lastPath();
    expect(() => keyring.addRoute({ routeKey: "run1", port: 9 })).toThrow();
    keyring.revoke("run1");
    const b = keyring.addRoute({ routeKey: "run1", port: 9 });
    expect(b.routeId).not.toBe(a.routeId);
    keyring.arm("run1");
    expect(keyring.claim(old, "c1").ok).toBe(false);
    expect(keyring.claim(lastPath(), "c2").ok).toBe(true);
  });

  it("never holds a key in its ledger", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    const path = lastPath();
    keyring.claim(path, "c1");
    const ledger = keyring.ledger("run1");
    expect(JSON.stringify(ledger).includes(path.split("/")[3] ?? "no key")).toBe(false);
    expect(ledger[0]?.spentBy).toBe("c1");
  });

  it("records a delivery that fails, and the key is still minted", () => {
    let url: string | null = null;
    const keyring = createKeyring({
      randomBytes: counterBytes(),
      deliver: (_routeKey: string, delivered: string | null) => {
        url = delivered;
        throw Object.assign(new Error("closed"), { code: "EPIPE" });
      },
    });
    keyring.addRoute({ routeKey: "run1", port: 9 });
    expect(keyring.arm("run1")).toEqual({ epoch: 1 });
    expect(keyring.ledger("run1")[0]?.deliveryError).toBe("EPIPE");
    expect(keyring.claim(new URL(url ?? "ws://x/").pathname, "c1").ok).toBe(true);
  });

  it("validates a route and its launches", () => {
    const { keyring } = setup();
    expect(() => keyring.addRoute({ routeKey: "", port: 9 })).toThrow();
    expect(() => keyring.addRoute({ routeKey: "x", port: 0 })).toThrow();
    expect(() => keyring.addRoute({ routeKey: "x", port: 70_000 })).toThrow();
    expect(() => keyring.arm("no-such-route")).toThrow();
    keyring.addRoute({ routeKey: "x", port: 9 });
    keyring.revoke("x");
    expect(() => keyring.arm("x")).toThrow();
  });

  it("gives the documented shapes with real randomness", () => {
    const urls: string[] = [];
    const keyring = createKeyring({
      deliver: (_k: string, url: string | null) => url && urls.push(url),
    });
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    expect(new URL(urls[0] ?? "ws://x/").pathname).toMatch(KEY_PATH_SHAPE);
  });

  it("supersedes nothing: a claim leaves the route's other live connections alone", () => {
    const { keyring, lastPath } = setup();
    keyring.addRoute({ routeKey: "run1", port: 9 });
    keyring.arm("run1");
    expect(keyring.claim(lastPath(), "engine")).toEqual({ ok: true, routeKey: "run1", epoch: 1 });
    keyring.arm("run1");
    expect(keyring.claim(lastPath(), "relaunch")).toEqual({ ok: true, routeKey: "run1", epoch: 2 });
    expect(keyring.liveConnections("run1")).toEqual([
      { connId: "engine", epoch: 1 },
      { connId: "relaunch", epoch: 2 },
    ]);
    expect(JSON.stringify(keyring.ledger("run1"))).not.toMatch(/supersede/u);
  });
});
