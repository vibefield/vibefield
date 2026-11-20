import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYSTEM_HEALTH_NATIVE_UNREADABLE, SystemHealthV1 } from "../src/mgmt";

// Item 600 (2026-11-19) — fieldd's `system.health` as a product client reads it.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, "system-health.valid.json"), "utf8"));

describe("item 600 — system.health as a product client reads it", () => {
  it("reads the panels' and the shell's fields, and lets fieldd's own blocks ride through", () => {
    const health = SystemHealthV1.parse(golden());
    expect([health.fieldd.bootId, health.fieldd.contractsVersion, health.fieldd.pid]).toEqual([
      "boot-01J9ZK3M5Q",
      "0.1.0",
      48211,
    ]);
    expect(health.nativeConnected).toBe(true);
    expect(health.native?.units.map((unit) => unit.unit)).toEqual([
      "mgmt",
      "terminal",
      "mesh-gateway",
    ]);
    expect(health.native?.units[2]?.authUrl).toBe("https://login.example.test/a/1f2e3d");
    expect(health.native?.units[2]?.detail).toBe("signing in");
    expect(health.nativeBuild).toBe("field-native 0.1.0 (a1b2c3d)");
    expect([health.docs.state, health.docs.docCount]).toEqual(["up", 3]);
    expect(health.mesh?.serves.map((serve) => serve.status)).toEqual(["serving", "failed"]);
    // fieldd's own blocks are not this contract's, and pass as they came
    expect((health as Record<string, unknown>)["plugins"]).toEqual({
      count: 4,
      enabled: 3,
      invalid: 0,
    });
  });

  it("reads a newer fieldd's words as themselves, and an older one without later fields", () => {
    const newer = golden();
    newer["native"] = { state: "draining", units: [{ unit: "door", state: "paused" }] };
    expect(SystemHealthV1.parse(newer).native?.units[0]?.state).toBe("paused");
    const older = golden();
    delete older["nativeBuild"];
    delete older["mesh"];
    older["native"] = null;
    const read = SystemHealthV1.parse(older);
    expect([read.nativeBuild, read.mesh, read.native]).toEqual([undefined, undefined, null]);
  });

  it("reads a floor block it cannot read as one wire word, and still reads fieldd's facts", () => {
    expect(SYSTEM_HEALTH_NATIVE_UNREADABLE).toBe("unreadable");
    for (const native of [{ n: 0 }, { state: "up" }, { state: "up", units: [{ unit: 1 }] }, "up"]) {
      const skewed = golden();
      skewed["native"] = native;
      const read = SystemHealthV1.parse(skewed);
      expect(read.native, JSON.stringify(native)).toEqual({
        state: SYSTEM_HEALTH_NATIVE_UNREADABLE,
        units: [],
      });
      expect(read.fieldd.bootId).toBe("boot-01J9ZK3M5Q");
    }
  });

  it("refuses an answer without fieldd's identity, the floor's link or the docs", () => {
    for (const drop of ["fieldd", "nativeConnected", "docs"]) {
      const answer = golden();
      delete answer[drop];
      expect(SystemHealthV1.safeParse(answer).success, drop).toBe(false);
    }
  });
});
