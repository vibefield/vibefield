import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hello, HelloAck } from "../src/envelope";
import { ProductInfo } from "../src/shell";
import { LayoutStamp, UserRecord, UsersFile } from "../src/users";

const here = dirname(fileURLToPath(import.meta.url));

// UA-1 — the users.json vector. TS-only by design-01 §7 (no native consumer);
// the fixture is the deliberate-change tripwire AND the unknown-key witness.
describe("UsersFile (golden vector)", () => {
  const raw = readFileSync(join(here, "..", "fixtures", "users.vector.json"), "utf8");

  it("parses the vector", () => {
    const file = UsersFile.parse(JSON.parse(raw));
    expect(file.version).toBe(1);
    expect(file.users).toHaveLength(2);
    expect(file.users[0]?.fuid).toBe(1);
    expect(file.lastAttached).toBe(file.users[0]?.userId);
  });

  it("preserves unknown keys through a read-modify-write round trip (UA-D10)", () => {
    const file = UsersFile.parse(JSON.parse(raw));
    const first = file.users[0];
    if (first === undefined) throw new Error("vector has no users");
    first.name = "renamed";
    const republished = JSON.parse(JSON.stringify(UsersFile.parse(file)));
    expect(republished.futureTopLevel).toEqual({ alsoSurvives: true });
    expect(republished.users[0].futureUserField).toBe("must survive a read-modify-write");
    expect(republished.users[0].name).toBe("renamed");
  });

  it("refuses structural corruption", () => {
    expect(() =>
      UsersFile.parse({ version: 2, nextFuid: 1, lastAttached: null, users: [] }),
    ).toThrow();
    expect(() => UserRecord.parse({ userId: "", fuid: 0, name: "", resident: true })).toThrow();
  });

  it("LayoutStamp parses both provenance values", () => {
    for (const previous of ["flat-v1", "fresh"] as const) {
      expect(
        LayoutStamp.parse({ layoutVersion: 2, migratedAt: "2026-08-05T00:00:00.000Z", previous })
          .previous,
      ).toBe(previous);
    }
  });
});

// UA-2 — identity threading shapes: the pair asserts which user it serves.
describe("identity threading (UA-2)", () => {
  const base = { contractsVersion: "1.0.0", minCompatible: "1.0.0", clientKind: "shell-main" };

  it("Hello carries an optional user expectation", () => {
    expect(Hello.parse({ ...base, userId: "01X" }).userId).toBe("01X");
    expect(Hello.parse(base).userId).toBeUndefined();
  });

  it("HelloAck asserts the server's user — string, null, or pre-UA-2 absent", () => {
    const ack = { contractsVersion: "1.0.0", serverKind: "fieldd", grantedScopes: [] };
    expect(HelloAck.parse({ ...ack, userId: "01X" }).userId).toBe("01X");
    expect(HelloAck.parse({ ...ack, userId: null }).userId).toBeNull();
    expect(HelloAck.parse(ack).userId).toBeUndefined();
  });

  it("ProductInfo records the served user; absence stays adoptable (tolerance)", () => {
    const info = {
      port: 4242,
      pid: 1,
      bootId: "b",
      contractsVersion: "1.0.0",
      startedAt: 0,
      nativePid: null,
    };
    expect(ProductInfo.parse({ ...info, userId: "01X" }).userId).toBe("01X");
    expect(ProductInfo.parse({ ...info, userId: null }).userId).toBeNull();
    expect(ProductInfo.parse(info).userId).toBeUndefined();
    expect(() => ProductInfo.parse({ ...info, userId: "" })).toThrow();
  });
});
