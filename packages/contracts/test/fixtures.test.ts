import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { Hello, HelloAck, RpcRequest, RpcResponse } from "../src/envelope";
import { ErrorData } from "../src/errors";
import {
  DesiredState,
  NativeHealth,
  ObservedState,
  PeerInfo,
  ServeConfig,
  ServeEntry,
  StoreSnapshot,
} from "../src/mgmt";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

// filename prefix (before the first ".") → schema
const SCHEMA_BY_PREFIX: Record<string, ZodTypeAny> = {
  hello: Hello,
  "hello-ack": HelloAck,
  "rpc-request": RpcRequest,
  "rpc-response": RpcResponse,
  "error-data": ErrorData,
  "native-health": NativeHealth,
  "desired-state": DesiredState,
  "observed-state": ObservedState,
  "peer-info": PeerInfo,
  "store-snapshot": StoreSnapshot,
  "serve-config": ServeConfig,
  "serve-entry": ServeEntry,
};

// *.vector.json = cross-language crypto vectors, not wire shapes — pinned by their own tests.
const isWireFixture = (f: string) => f.endsWith(".json") && !f.endsWith(".vector.json");

describe("golden fixtures parse (the fixture is the contract)", () => {
  const files = readdirSync(FIXTURES).filter(isWireFixture);
  it("covers every fixture with a schema", () => {
    for (const f of files) {
      const prefix = f.split(".")[0]!;
      expect(SCHEMA_BY_PREFIX[prefix], `no schema mapped for fixture ${f}`).toBeDefined();
    }
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  for (const f of readdirSync(FIXTURES).filter(isWireFixture)) {
    it(`parses ${f}`, () => {
      const prefix = f.split(".")[0]!;
      const schema = SCHEMA_BY_PREFIX[prefix]!;
      const raw = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
      const parsed = schema.safeParse(raw);
      expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
    });
  }
});

describe("P3 — tolerant reader", () => {
  it("passthrough preserves unknown fields end-to-end", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, "hello.unknown-field.json"), "utf8"));
    const parsed = Hello.parse(raw);
    // unknown fields survive the parse (removal would be silent data loss at proxies)
    expect((parsed as Record<string, unknown>)["futureField"]).toEqual(raw.futureField);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(raw);
  });
});
