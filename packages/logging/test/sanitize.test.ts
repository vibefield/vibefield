import { LogRecordV1 } from "@vibefield/contracts/logging";
import { describe, expect, it } from "vitest";
import { type NormalizeRecordInput, normalizeLogRecord, serializeError } from "../src/sanitize";

function record(overrides: Partial<NormalizeRecordInput> = {}) {
  return normalizeLogRecord({
    level: "info",
    event: "fieldd.test.recorded",
    message: "test record",
    bindings: {},
    service: "fieldd",
    role: "daemon",
    component: "test",
    pid: 42,
    bootId: "boot-1",
    instanceId: "instance-1",
    seq: 1,
    time: 1_700_000_000_000,
    maxRecordBytes: 64 * 1024,
    ...overrides,
  });
}

describe("logging sanitizer", () => {
  it("redacts explicit secret keys and known secret patterns at every depth", () => {
    const token = "vf-secret-token-1234567890";
    const result = record({
      message: `Bearer ${token}`,
      attrs: {
        authorization: `Bearer ${token}`,
        proxy_authorization: token,
        nested: {
          accessToken: token,
          sessionCookie: token,
          tokenCount: 17,
          secretPresent: true,
        },
        route: `/t/${token}`,
        header: `Cookie: ${token}`,
      },
    });

    expect(result).not.toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token);
    expect(result?.attrs?.nested).toEqual({
      accessToken: "[redacted]",
      sessionCookie: "[redacted]",
      tokenCount: 17,
      secretPresent: true,
    });
  });

  it("scrubs URL userinfo, query values, fragments, private keys, and path aliases", () => {
    const home = "/Users/person";
    const logs = `${home}/Library/Logs/VibeField`;
    const result = record({
      message:
        "open https://alice:password@example.test/repair?token=canary#private " +
        `${logs}/system/fieldd.ndjson`,
      attrs: {
        pem: "-----BEGIN PRIVATE KEY-----\ncanary\n-----END PRIVATE KEY-----",
        path: `${home}/Documents/board.field`,
      },
      aliases: { home, logs },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("canary");
    expect(serialized).not.toContain("?token");
    expect(serialized).not.toContain("#private");
    expect(serialized).toContain("<logs>/system/fieldd.ndjson");
    expect(serialized).toContain("<home>/Documents/board.field");
  });

  it("never invokes getters or toJSON and fails closed on hostile proxies", () => {
    let invoked = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "getter", {
      enumerable: true,
      get() {
        invoked += 1;
        throw new Error("getter ran");
      },
    });
    Object.defineProperty(hostile, "toJSON", {
      enumerable: true,
      value() {
        invoked += 1;
        throw new Error("toJSON ran");
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy trap");
        },
      },
    );

    const safe = record({ attrs: { hostile } });
    const trapped = record({ attrs: proxy });
    expect(invoked).toBe(0);
    expect(safe?.attrs?.hostile).toEqual({ toJSON: "[unsupported:function]" });
    expect(trapped?.attrs).toBeUndefined();
  });

  it("bounds cycles, depth, sparse arrays, object keys, and unsupported values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 12; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const sparse: unknown[] = [];
    sparse.length = 1_000_000_000;
    sparse[99] = "last accepted";
    const wide = Object.fromEntries(
      Array.from({ length: 150 }, (_, index) => [`field${index}`, index]),
    );

    const result = record({
      attrs: {
        circular,
        deep,
        sparse,
        wide,
        bigint: 9_007_199_254_740_993n,
        fn: () => undefined,
        symbol: Symbol("unsafe"),
        bytes: Buffer.alloc(32),
      },
    });

    expect(result).not.toBeNull();
    expect(LogRecordV1.safeParse(result).success).toBe(true);
    expect(result?.truncation?.reasons).toEqual(
      expect.arrayContaining(["object-depth", "array-items", "object-keys"]),
    );
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(64 * 1024);
  });

  it("serializes cross-realm-style errors, bounded causes, and stacks without getters", () => {
    const root = Object.create(null) as Record<string, unknown>;
    root.name = "RemoteFailure";
    root.message = "operation failed";
    root.code = 503;
    root.stack = `RemoteFailure: operation failed\n${" at remote (worker.js:1:1)\n".repeat(4_000)}`;
    root.cause = new Error("inner");
    Object.defineProperty(root, "ignored", {
      get() {
        throw new Error("must not run");
      },
    });

    const serialized = serializeError(root);
    expect(serialized.type).toBe("RemoteFailure");
    expect(serialized.code).toBe("503");
    expect(Buffer.byteLength(serialized.stack ?? "", "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(serialized.causes?.[0]?.message).toBe("inner");
  });

  it("deterministically enforces the final record limit and physical NDJSON framing", () => {
    const attrs = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `field${String(index).padStart(3, "0")}`,
        `${index}:${"value\nwith-newline".repeat(2_000)}`,
      ]),
    );
    const first = record({
      message: `line one\r\nline two ${"\ud800".repeat(20_000)}`,
      attrs,
      error: new Error("failure\nwith newline"),
    });
    const second = record({
      message: `line one\r\nline two ${"\ud800".repeat(20_000)}`,
      attrs,
      error: new Error("failure\nwith newline"),
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const encoded = JSON.stringify(first);
    expect(encoded).toBe(JSON.stringify(second));
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(encoded.split("\n")).toHaveLength(1);
    expect(first?.truncation?.reasons).toContain("record-bytes");
    expect(LogRecordV1.safeParse(first).success).toBe(true);
  });

  it("drops invalid host-controlled event and component names", () => {
    expect(record({ event: "user supplied value" })).toBeNull();
    expect(record({ component: "../escape" })).toBeNull();
  });
});
